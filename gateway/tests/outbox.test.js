import { describe, it, expect, vi } from 'vitest';

import { crearOutbox, cuerpoGraph, enviarPorGraph, colaDe, COLA_MUERTOS, COLA_REINTENTOS } from '../src/outbox.js';
import { crearRedisFalso } from './ayudas/redis-falso.js';
import { PHONE_ID, CLIENTE } from './ayudas/payloads.js';

/**
 * Reloj determinístico. Los reintentos ya no viven en un setTimeout sino en un
 * sorted set de redis con score = cuándo toca (H13), así que para hacerlos
 * efectivos se adelanta el reloj y se barre: `prog.correr()`.
 */
function programador(redis) {
  let t = 1_000_000;
  const outboxRef = { actual: null };
  return {
    ahora: () => t,
    usar: (o) => { outboxRef.actual = o; },
    /** Cuánto falta para cada reintento pendiente, en ms. */
    esperas: () => redis.zsetJson(COLA_REINTENTOS).map((e) => e.score - t),
    /** Adelanta el reloj hasta el reintento más lejano y los devuelve a la cola. */
    async correr() {
      const pendientes = redis.zsetJson(COLA_REINTENTOS);
      if (pendientes.length) t = Math.max(...pendientes.map((e) => e.score));
      return outboxRef.actual.rescatar();
    },
  };
}

function armar({ enviar, maxIntentos } = {}) {
  const redis = crearRedisFalso();
  const prog = programador(redis);
  const outbox = crearOutbox({
    redis,
    enviar: enviar || vi.fn(async () => ({ messages: [{ id: 'wamid.OK' }] })),
    colas: () => [colaDe(PHONE_ID)],
    ahora: prog.ahora,
    maxIntentos,
  });
  prog.usar(outbox);
  return { redis, outbox, prog };
}

const TEXTO = { phone_number_id: PHONE_ID, telefono: CLIENTE, tipo: 'texto', texto: 'listo, te espero el jueves' };

// ─────────────────────────────────────────────────────────────────────────────
describe('encolar', () => {
  it('mete el mensaje en la cola del phone_number_id', async () => {
    const { redis, outbox } = armar();
    await outbox.encolar(TEXTO);
    const [item] = redis.listaJson(colaDe(PHONE_ID));
    expect(item).toMatchObject({ telefono: CLIENTE, tipo: 'texto', intentos: 0 });
    expect(item.id).toBeTruthy();
  });

  it('cada comercio tiene su cola: uno enojado no tapa al otro', async () => {
    const { redis, outbox } = armar();
    await outbox.encolar(TEXTO);
    await outbox.encolar({ ...TEXTO, phone_number_id: '777' });
    expect(await redis.lLen(colaDe(PHONE_ID))).toBe(1);
    expect(await redis.lLen(colaDe('777'))).toBe(1);
  });

  it('descarta un texto vacío en vez de mandarle nada a Meta', async () => {
    const { redis, outbox } = armar();
    expect(await outbox.encolar({ ...TEXTO, texto: '   ' })).toBeNull();
    expect(await redis.lLen(colaDe(PHONE_ID))).toBe(0);
  });

  it('exige plantilla cuando el tipo es plantilla', async () => {
    const { outbox } = armar();
    await expect(outbox.encolar({ ...TEXTO, tipo: 'plantilla', texto: undefined }))
      .rejects.toThrow(/plantilla/);
  });

  it('exige destinatario', async () => {
    const { outbox } = armar();
    await expect(outbox.encolar({ tipo: 'texto', texto: 'hola' })).rejects.toThrow(/telefono/);
  });

  it('respeta el orden FIFO', async () => {
    const { outbox } = armar();
    await outbox.encolar({ ...TEXTO, texto: 'primero' });
    await outbox.encolar({ ...TEXTO, texto: 'segundo' });
    const uno = await outbox.tick();
    const dos = await outbox.tick();
    expect(uno.item.texto).toBe('primero');
    expect(dos.item.texto).toBe('segundo');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('entrega y reintentos', () => {
  it('entrega y saca de la cola', async () => {
    const enviar = vi.fn(async () => ({}));
    const { redis, outbox } = armar({ enviar });
    await outbox.encolar(TEXTO);
    const r = await outbox.tick();
    expect(r.resultado).toBe('entregado');
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(await redis.lLen(colaDe(PHONE_ID))).toBe(0);
  });

  it('reintenta con backoff exponencial y termina entregando', async () => {
    let intentos = 0;
    const enviar = vi.fn(async () => {
      intentos++;
      if (intentos < 3) throw new Error('ETIMEDOUT');
      return {};
    });
    const { redis, outbox, prog } = armar({ enviar });
    await outbox.encolar(TEXTO);

    expect((await outbox.tick()).resultado).toBe('reintenta');
    expect(prog.esperas()).toEqual([1000]);
    await prog.correr();

    expect((await outbox.tick()).resultado).toBe('reintenta');
    expect(prog.esperas()).toEqual([2000]);
    await prog.correr();

    expect((await outbox.tick()).resultado).toBe('entregado');
    expect(enviar).toHaveBeenCalledTimes(3);
    expect(await redis.lLen(colaDe(PHONE_ID))).toBe(0);
    expect(await redis.lLen(COLA_MUERTOS)).toBe(0);
  });

  it('el reintento conserva el contenido y suma el intento', async () => {
    const enviar = vi.fn(async () => { throw new Error('500 Graph'); });
    const { redis, outbox, prog } = armar({ enviar });
    await outbox.encolar(TEXTO);
    await outbox.tick();
    await prog.correr();

    const [reencolado] = redis.listaJson(colaDe(PHONE_ID));
    expect(reencolado).toMatchObject({ texto: TEXTO.texto, intentos: 1 });
    expect(reencolado.ultimo_error).toContain('500 Graph');
  });

  it('el reintento va al frente de la cola, no al fondo', async () => {
    const enviar = vi.fn(async (m) => { if (m.texto === 'el que falla') throw new Error('nope'); });
    const { outbox, prog } = armar({ enviar });
    await outbox.encolar({ ...TEXTO, texto: 'el que falla' });
    await outbox.encolar({ ...TEXTO, texto: 'el que vino después' });

    await outbox.tick();      // agarra el que falla
    await prog.correr();      // lo reencola

    const siguiente = await outbox.tick();
    expect(siguiente.item.texto).toBe('el que falla');
  });

  it('a los 3 intentos muere y queda en la DLQ, no se pierde', async () => {
    const enviar = vi.fn(async () => { throw new Error('Graph 400: número inválido'); });
    const { redis, outbox, prog } = armar({ enviar });
    await outbox.encolar(TEXTO);

    expect((await outbox.tick()).resultado).toBe('reintenta');
    await prog.correr();
    expect((await outbox.tick()).resultado).toBe('reintenta');
    await prog.correr();
    expect((await outbox.tick()).resultado).toBe('muerto');

    expect(enviar).toHaveBeenCalledTimes(3);
    expect(await redis.lLen(colaDe(PHONE_ID))).toBe(0);

    const [muerto] = redis.listaJson(COLA_MUERTOS);
    expect(muerto).toMatchObject({ texto: TEXTO.texto, telefono: CLIENTE, intentos: 3 });
    expect(muerto.ultimo_error).toContain('400');
  });

  it('el que espera su reintento vive en redis, no en el proceso', async () => {
    const { redis, outbox } = armar({ enviar: async () => { throw new Error('ETIMEDOUT'); } });
    await outbox.encolar(TEXTO);
    await outbox.tick();

    // Salió de su cola, pero NO se evaporó: está en el sorted set con la hora
    // en la que hay que volver a intentar.
    expect(await redis.lLen(colaDe(PHONE_ID))).toBe(0);
    const [pendiente] = redis.zsetJson(COLA_REINTENTOS);
    expect(pendiente.item).toMatchObject({ texto: TEXTO.texto, intentos: 1 });
    expect(pendiente.score).toBeGreaterThan(0);
  });

  it('un SIGTERM durante el backoff no se come el mensaje', async () => {
    // Este es el bug: el reintento vivía adentro de un setTimeout. Si el
    // proceso moría en esa ventana —deploy, OOM, SIGTERM— el mensaje no llegaba
    // ni a la DLQ: desaparecía y sólo se notaba porque el cliente nunca
    // recibió la respuesta (H13).
    const redis = crearRedisFalso();
    let t = 1_000_000;
    const caido = crearOutbox({
      redis,
      enviar: async () => { throw new Error('Graph 503'); },
      colas: () => [colaDe(PHONE_ID)],
      ahora: () => t,
    });
    await caido.encolar(TEXTO);
    await caido.tick();          // falla y programa el reintento
    await caido.detener();       // ...y acá se muere el proceso

    // Arranca un gateway nuevo: memoria en cero, mismo redis.
    const entregados = [];
    const revivido = crearOutbox({
      redis,
      enviar: async (m) => { entregados.push(m.texto); },
      colas: () => [colaDe(PHONE_ID)],
      ahora: () => t,
    });
    t += 5000; // pasó el backoff
    expect(await revivido.rescatar()).toBe(1);
    expect((await revivido.tick()).resultado).toBe('entregado');
    expect(entregados).toEqual([TEXTO.texto]);
  });

  it('el barrido no devuelve el que todavía no cumplió su espera', async () => {
    const { redis, outbox } = armar({ enviar: async () => { throw new Error('ETIMEDOUT'); } });
    await outbox.encolar(TEXTO);
    await outbox.tick();

    expect(await outbox.rescatar()).toBe(0); // el reloj no avanzó
    expect(await redis.lLen(colaDe(PHONE_ID))).toBe(0);
    expect(await redis.zCard(COLA_REINTENTOS)).toBe(1);
  });

  it('dos gateways sobre el mismo redis no reencolan el mismo mensaje dos veces', async () => {
    const redis = crearRedisFalso();
    let t = 1_000_000;
    const opciones = {
      redis,
      enviar: async () => { throw new Error('Graph 503'); },
      colas: () => [colaDe(PHONE_ID)],
      ahora: () => t,
    };
    const uno = crearOutbox(opciones);
    const otro = crearOutbox(opciones);

    await uno.encolar(TEXTO);
    await uno.tick();
    t += 5000;

    const rescatados = (await uno.rescatar()) + (await otro.rescatar());
    expect(rescatados).toBe(1);
    expect(await redis.lLen(colaDe(PHONE_ID))).toBe(1);
  });

  it('un maxIntentos de 1 muere al primer fallo', async () => {
    const { redis, outbox } = armar({
      enviar: async () => { throw new Error('caído'); },
      maxIntentos: 1,
    });
    await outbox.encolar(TEXTO);
    expect((await outbox.tick()).resultado).toBe('muerto');
    expect(await redis.lLen(COLA_MUERTOS)).toBe(1);
  });

  it('un mensaje ilegible en la cola se descarta sin tumbar el worker', async () => {
    const { redis, outbox } = armar();
    await redis.lPush(colaDe(PHONE_ID), 'esto no es json');
    await expect(outbox.tick()).resolves.toBeNull();
  });

  it('sin colas configuradas el tick no hace nada', async () => {
    const outbox = crearOutbox({ redis: crearRedisFalso(), enviar: vi.fn(), colas: () => [] });
    expect(await outbox.tick()).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('cuerpo que se le manda a Graph', () => {
  it('texto', () => {
    expect(cuerpoGraph({ telefono: CLIENTE, tipo: 'texto', texto: 'hola' })).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: CLIENTE,
      type: 'text',
      text: { preview_url: false, body: 'hola' },
    });
  });

  it('plantilla con variables en array posicional: el contrato E7 sale tal cual', () => {
    // recordatorio_turno: {{1}} nombre, {{2}} fecha_hora_local, {{3}} negocio.
    const cuerpo = cuerpoGraph({
      telefono: CLIENTE,
      tipo: 'plantilla',
      plantilla: 'recordatorio_turno',
      variables: ['Carla', 'jueves 10:30', 'Rotisería'],
    });
    expect(cuerpo.type).toBe('template');
    expect(cuerpo.template.name).toBe('recordatorio_turno');
    expect(cuerpo.template.language).toEqual({ code: 'es_AR' });
    expect(cuerpo.template.components[0].parameters.map((p) => p.text))
      .toEqual(['Carla', 'jueves 10:30', 'Rotisería']);
  });

  it('plantilla con variables en array: posicional tal cual', () => {
    const cuerpo = cuerpoGraph({
      telefono: CLIENTE, tipo: 'plantilla', plantilla: 'pedido_listo', variables: ['Carla', '3 empanadas'],
    });
    expect(cuerpo.template.components[0].parameters).toEqual([
      { type: 'text', text: 'Carla' },
      { type: 'text', text: '3 empanadas' },
    ]);
  });

  it('objeto como variables: se acepta por compat, pero NO se garantiza el orden', () => {
    // El core manda array; si alguien manda objeto, se cae a Object.values().
    // Es sólo la red de seguridad — el contrato real es el array de arriba.
    const cuerpo = cuerpoGraph({
      telefono: CLIENTE,
      tipo: 'plantilla',
      plantilla: 'recordatorio_turno',
      variables: { nombre: 'Carla', fecha_hora_local: 'jueves 10:30', negocio: 'Rotisería' },
    });
    expect(cuerpo.template.components[0].parameters.map((p) => p.text))
      .toEqual(['Carla', 'jueves 10:30', 'Rotisería']);
  });

  it('plantilla sin variables no manda components vacíos rotos', () => {
    const cuerpo = cuerpoGraph({ telefono: CLIENTE, tipo: 'plantilla', plantilla: 'hola' });
    expect(cuerpo.template.components).toEqual([]);
  });
});

describe('enviarPorGraph', () => {
  const config = { graphUrl: 'https://graph.test/v21.0', metaGraphToken: 'TOKEN123' };

  it('pega en /<phone_number_id>/messages con el bearer', async () => {
    const fetchFalso = vi.fn(async () => ({ ok: true, json: async () => ({ messages: [{ id: 'wamid.X' }] }) }));
    const enviar = enviarPorGraph(config, fetchFalso);
    await enviar({ phone_number_id: PHONE_ID, telefono: CLIENTE, tipo: 'texto', texto: 'hola' });

    const [url, opciones] = fetchFalso.mock.calls[0];
    expect(url).toBe(`https://graph.test/v21.0/${PHONE_ID}/messages`);
    expect(opciones.headers.Authorization).toBe('Bearer TOKEN123');
    expect(JSON.parse(opciones.body).text.body).toBe('hola');
  });

  it('tira cuando Graph contesta mal, para que el outbox reintente', async () => {
    const fetchFalso = vi.fn(async () => ({
      ok: false, status: 429, text: async () => '{"error":{"message":"rate limit"}}',
    }));
    const enviar = enviarPorGraph(config, fetchFalso);
    await expect(enviar({ phone_number_id: PHONE_ID, telefono: CLIENTE, tipo: 'texto', texto: 'x' }))
      .rejects.toThrow(/429/);
  });
});
