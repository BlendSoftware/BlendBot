import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

import { crearApp, RUTA_WEBHOOK } from '../src/index.js';
import { crearRouter, extraerEventos, textoDelMensaje, DISCULPA, SOLO_TEXTO } from '../src/webhook.js';
import { tenantsDeObjeto } from '../src/tenants.js';
import { firmar } from '../src/firma.js';
import { AgenteTimeout } from '../src/agente.js';
import { crearRedisFalso } from './ayudas/redis-falso.js';
import * as fx from './ayudas/payloads.js';

const SECRETO = 'app_secret_de_prueba';
const VERIFY = 'token_de_verificacion';

function armar({ responder } = {}) {
  const trabajos = [];
  const redis = crearRedisFalso();
  const tenants = tenantsDeObjeto(fx.TENANTS);
  const enviados = [];

  const agente = {
    responder: responder || vi.fn(async ({ texto }) => ({
      texto: `respuesta a: ${texto}`, sesionId: 'ses-1', reanudo: false,
    })),
  };
  const outbox = { encolar: vi.fn(async (m) => { enviados.push(m); return m; }) };

  const config = {
    metaAppSecret: SECRETO,
    metaVerifyToken: VERIFY,
  };

  const app = crearApp({
    config, tenants, redis, agente, outbox,
    diferir: (fn) => { trabajos.push(fn()); },
  });

  return {
    app, redis, tenants, agente, outbox, enviados,
    async esperar() { await Promise.all(trabajos); },
  };
}

function postFirmado(app, payload, { secreto = SECRETO } = {}) {
  const crudo = JSON.stringify(payload);
  return request(app)
    .post(RUTA_WEBHOOK)
    .set('Content-Type', 'application/json')
    .set('X-Hub-Signature-256', firmar(crudo, secreto))
    .send(crudo);
}

// ─────────────────────────────────────────────────────────────────────────────
describe('GET de verificación', () => {
  it('devuelve el challenge cuando el token coincide', async () => {
    const { app } = armar();
    const res = await request(app).get(RUTA_WEBHOOK).query({
      'hub.mode': 'subscribe', 'hub.verify_token': VERIFY, 'hub.challenge': '1158201444',
    });
    expect(res.status).toBe(200);
    expect(res.text).toBe('1158201444');
  });

  it('403 si el verify_token no es el nuestro', async () => {
    const { app } = armar();
    const res = await request(app).get(RUTA_WEBHOOK).query({
      'hub.mode': 'subscribe', 'hub.verify_token': 'trucho', 'hub.challenge': '123',
    });
    expect(res.status).toBe(403);
    expect(res.text).not.toContain('123');
  });

  it('403 si el modo no es subscribe', async () => {
    const { app } = armar();
    const res = await request(app).get(RUTA_WEBHOOK).query({
      'hub.mode': 'unsubscribe', 'hub.verify_token': VERIFY, 'hub.challenge': '123',
    });
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST: la firma es la puerta', () => {
  it('401 y no procesa nada si la firma no cierra', async () => {
    const ctx = armar();
    const res = await postFirmado(ctx.app, fx.textoEntrante(), { secreto: 'otro_secreto' });
    await ctx.esperar();
    expect(res.status).toBe(401);
    expect(ctx.agente.responder).not.toHaveBeenCalled();
    expect(ctx.outbox.encolar).not.toHaveBeenCalled();
  });

  it('401 si no viene el header', async () => {
    const ctx = armar();
    const res = await request(ctx.app)
      .post(RUTA_WEBHOOK)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(fx.textoEntrante()));
    await ctx.esperar();
    expect(res.status).toBe(401);
    expect(ctx.agente.responder).not.toHaveBeenCalled();
  });

  it('200 con firma válida', async () => {
    const ctx = armar();
    const res = await postFirmado(ctx.app, fx.textoEntrante());
    await ctx.esperar();
    expect(res.status).toBe(200);
  });

  it('el 200 sale ANTES de que termine el procesamiento', async () => {
    let liberar;
    const bloqueada = new Promise((r) => { liberar = r; });
    const ctx = armar({
      responder: vi.fn(async () => { await bloqueada; return { texto: 'ok' }; }),
    });

    const res = await postFirmado(ctx.app, fx.textoEntrante());
    expect(res.status).toBe(200);
    // Todavía no encoló nada: el agente sigue trabajando.
    expect(ctx.outbox.encolar).not.toHaveBeenCalled();

    liberar();
    await ctx.esperar();
    expect(ctx.outbox.encolar).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('idempotencia por message.id', () => {
  it('el mismo mensaje dos veces se procesa una sola vez', async () => {
    const ctx = armar();
    const payload = fx.textoEntrante({ id: 'wamid.REPETIDO' });

    await postFirmado(ctx.app, payload);
    await postFirmado(ctx.app, payload);
    await ctx.esperar();

    expect(ctx.agente.responder).toHaveBeenCalledTimes(1);
    expect(ctx.outbox.encolar).toHaveBeenCalledTimes(1);
  });

  it('deja la marca en redis con TTL de 24hs', async () => {
    const ctx = armar();
    await postFirmado(ctx.app, fx.textoEntrante({ id: 'wamid.TTL' }));
    await ctx.esperar();

    expect(await ctx.redis.get('wa:msg:wamid.TTL')).toBe('1');
    expect(await ctx.redis.ttl('wa:msg:wamid.TTL')).toBe(24 * 60 * 60);
  });

  it('dos mensajes distintos en el mismo POST se procesan los dos', async () => {
    const ctx = armar();
    await postFirmado(ctx.app, fx.loteDeDos());
    await ctx.esperar();
    expect(ctx.agente.responder).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('parsing de payloads reales de la Cloud API', () => {
  const casos = [
    ['texto', fx.textoEntrante({ cuerpo: 'quiero un turno' }), 'quiero un turno'],
    ['botón interactivo', fx.botonInteractivo({ titulo: 'Confirmar turno' }), 'Confirmar turno'],
    ['opción de lista', fx.opcionDeLista({ titulo: 'Jueves 10:30' }), 'Jueves 10:30'],
    ['botón de plantilla', fx.botonDePlantilla({ texto: 'Confirmar' }), 'Confirmar'],
  ];

  it.each(casos)('extrae el texto de %s', (_nombre, payload, esperado) => {
    const [ev] = extraerEventos(payload);
    expect(textoDelMensaje(ev.message)).toBe(esperado);
  });

  it.each(casos)('%s llega al agente', async (_nombre, payload, esperado) => {
    const ctx = armar();
    await postFirmado(ctx.app, payload);
    await ctx.esperar();
    expect(ctx.agente.responder).toHaveBeenCalledWith(
      expect.objectContaining({ texto: esperado, telefono: fx.CLIENTE }),
    );
  });

  it('ignora los acuses de entrega (statuses)', async () => {
    expect(extraerEventos(fx.estadoEntregado())).toHaveLength(0);
    const ctx = armar();
    await postFirmado(ctx.app, fx.estadoEntregado());
    await ctx.esperar();
    expect(ctx.agente.responder).not.toHaveBeenCalled();
  });

  it('ignora los campos que no son "messages"', () => {
    expect(extraerEventos(fx.campoQueNoEsMensajes())).toHaveLength(0);
  });

  it('ignora el eco del propio número del negocio', () => {
    const payload = fx.textoEntrante({ telefono: fx.NUMERO_NEGOCIO });
    expect(extraerEventos(payload)).toHaveLength(0);
  });

  it('no explota con un body vacío o raro', () => {
    expect(extraerEventos({})).toHaveLength(0);
    expect(extraerEventos(null)).toHaveLength(0);
    expect(extraerEventos({ entry: [{ changes: [{ field: 'messages', value: {} }] }] })).toHaveLength(0);
  });

  it('trae el nombre del perfil del contacto', () => {
    const [ev] = extraerEventos(fx.textoEntrante());
    expect(ev.nombre).toBe('Carla Gómez');
    expect(ev.phoneNumberId).toBe(fx.PHONE_ID);
  });

  it.each([
    ['audio', fx.audioEntrante()],
    ['imagen', fx.imagenEntrante()],
  ])('un %s se avisa al cliente en vez de quedar en silencio', async (_n, payload) => {
    const ctx = armar();
    await postFirmado(ctx.app, payload);
    await ctx.esperar();
    expect(ctx.agente.responder).not.toHaveBeenCalled();
    expect(ctx.enviados[0]).toMatchObject({ tipo: 'texto', texto: SOLO_TEXTO });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('tenants', () => {
  it('un phone_number_id desconocido se descarta sin contestar', async () => {
    const ctx = armar();
    await postFirmado(ctx.app, fx.textoEntrante({ phoneNumberId: fx.PHONE_ID_AJENO }));
    await ctx.esperar();
    expect(ctx.agente.responder).not.toHaveBeenCalled();
    expect(ctx.outbox.encolar).not.toHaveBeenCalled();
    // Tampoco gasta la marca de idempotencia: no era tráfico nuestro.
    expect(ctx.redis.clavesVigentes()).toHaveLength(0);
  });

  it('le pasa al agente el tenant que corresponde al phone_number_id', async () => {
    const ctx = armar();
    await postFirmado(ctx.app, fx.textoEntrante());
    await ctx.esperar();
    const { tenant } = ctx.agente.responder.mock.calls[0][0];
    expect(tenant.agente_token).toBe('cop_token_de_prueba');
    expect(tenant.vertical).toBe('salud');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('errores del agente: nunca silencio', () => {
  it('un timeout termina en disculpa, no en nada', async () => {
    const ctx = armar({ responder: vi.fn(async () => { throw new AgenteTimeout(90_000); }) });
    await postFirmado(ctx.app, fx.textoEntrante());
    await ctx.esperar();
    expect(ctx.enviados[0]).toMatchObject({ tipo: 'texto', texto: DISCULPA });
  });

  it('un error cualquiera del modelo también termina en disculpa', async () => {
    const ctx = armar({ responder: vi.fn(async () => { throw new Error('529 overloaded'); }) });
    await postFirmado(ctx.app, fx.textoEntrante());
    await ctx.esperar();
    expect(ctx.enviados[0]).toMatchObject({ texto: DISCULPA });
  });

  it('una respuesta vacía del modelo también se disculpa', async () => {
    const ctx = armar({ responder: vi.fn(async () => ({ texto: '   ', sesionId: 'x' })) });
    await postFirmado(ctx.app, fx.textoEntrante());
    await ctx.esperar();
    expect(ctx.enviados[0]).toMatchObject({ texto: DISCULPA });
  });

  it('un mensaje que falla no frena el siguiente del mismo lote', async () => {
    let n = 0;
    const ctx = armar({
      responder: vi.fn(async () => {
        n++;
        if (n === 1) throw new Error('se cayó');
        return { texto: 'la segunda salió' };
      }),
    });
    await postFirmado(ctx.app, fx.loteDeDos());
    await ctx.esperar();
    expect(ctx.enviados.map((m) => m.texto)).toEqual([DISCULPA, 'la segunda salió']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('router: procesarLote directo', () => {
  let ctx;
  beforeEach(() => { ctx = armar(); });

  it('devuelve el estado por mensaje', async () => {
    const router = crearRouter({
      config: { metaAppSecret: SECRETO, metaVerifyToken: VERIFY },
      tenants: tenantsDeObjeto(fx.TENANTS),
      redis: ctx.redis,
      agente: ctx.agente,
      outbox: ctx.outbox,
    });
    const primera = await router.procesarLote(fx.textoEntrante({ id: 'wamid.DIRECTO' }));
    expect(primera).toEqual([{ estado: 'respondido', id: 'wamid.DIRECTO' }]);

    const segunda = await router.procesarLote(fx.textoEntrante({ id: 'wamid.DIRECTO' }));
    expect(segunda).toEqual([{ estado: 'duplicado', id: 'wamid.DIRECTO' }]);
  });
});
