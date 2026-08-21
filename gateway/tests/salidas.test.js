import { describe, it, expect, vi } from 'vitest';

import { crearSalidas, COLA_SALIDAS } from '../src/salidas.js';
import { crearOutbox, colaDe } from '../src/outbox.js';
import { tenantsDeObjeto } from '../src/tenants.js';
import { crearRedisFalso } from './ayudas/redis-falso.js';
import { PHONE_ID, PHONE_ID_AJENO, CLIENTE, TENANTS } from './ayudas/payloads.js';

function armar() {
  const redis = crearRedisFalso();
  const tenants = tenantsDeObjeto(TENANTS);
  const outbox = crearOutbox({ redis, enviar: vi.fn(async () => ({})), colas: () => [colaDe(PHONE_ID)] });
  const salidas = crearSalidas({ redis, outbox, tenants });
  return { redis, outbox, salidas, tenants };
}

/** El payload tal cual lo encola el core en E7. */
const RECORDATORIO = {
  negocio_id: 'b1e3f2a0-0000-4000-8000-000000000001',
  wa_phone_id: PHONE_ID,
  telefono: CLIENTE,
  tipo: 'plantilla',
  plantilla: 'recordatorio_turno',
  variables: { nombre: 'Carla', fecha_hora_local: 'jueves 10:30', negocio: 'Rotisería' },
  compromiso_id: 'c0ffee00-0000-4000-8000-000000000009',
};

describe('consumidor de salidas_whatsapp', () => {
  it('la cola es la que documenta E7', () => {
    expect(COLA_SALIDAS).toBe('salidas_whatsapp');
  });

  it('un recordatorio del core termina en el outbox del comercio', async () => {
    const { redis, salidas } = armar();
    await redis.lPush(COLA_SALIDAS, JSON.stringify(RECORDATORIO));

    expect(await salidas.tick()).toEqual({ estado: 'encolado' });

    const [item] = redis.listaJson(colaDe(PHONE_ID));
    expect(item).toMatchObject({
      phone_number_id: PHONE_ID,
      telefono: CLIENTE,
      tipo: 'plantilla',
      plantilla: 'recordatorio_turno',
      negocio_id: RECORDATORIO.negocio_id,
    });
    expect(item.variables).toEqual(RECORDATORIO.variables);
  });

  it('un texto proactivo también pasa (aunque la ventana de 24hs lo pueda rebotar)', async () => {
    const { redis, salidas } = armar();
    await salidas.procesar(JSON.stringify({
      negocio_id: 'n1', wa_phone_id: PHONE_ID, telefono: CLIENTE, tipo: 'texto', texto: 'ya está listo',
    }));
    expect(redis.listaJson(colaDe(PHONE_ID))[0]).toMatchObject({ tipo: 'texto', texto: 'ya está listo' });
  });

  it('un wa_phone_id que no está en tenants.json se descarta y se loguea', async () => {
    const { redis, salidas } = armar();
    const aviso = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await salidas.procesar({ ...RECORDATORIO, wa_phone_id: PHONE_ID_AJENO });
    expect(r).toEqual({ estado: 'tenant_desconocido' });
    expect(await redis.lLen(colaDe(PHONE_ID_AJENO))).toBe(0);
    expect(aviso).toHaveBeenCalled();
    aviso.mockRestore();
  });

  it('un JSON roto no tumba el worker', async () => {
    const { salidas } = armar();
    const aviso = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await salidas.procesar('{esto no cierra')).toEqual({ estado: 'ilegible' });
    aviso.mockRestore();
  });

  it('sin telefono o sin wa_phone_id se descarta', async () => {
    const { salidas } = armar();
    const aviso = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await salidas.procesar({ wa_phone_id: PHONE_ID })).estado).toBe('invalido');
    expect((await salidas.procesar({ telefono: CLIENTE })).estado).toBe('invalido');
    aviso.mockRestore();
  });

  it('tipo plantilla sin nombre de plantilla se descarta', async () => {
    const { salidas } = armar();
    const aviso = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await salidas.procesar({ ...RECORDATORIO, plantilla: undefined });
    expect(r).toEqual({ estado: 'invalido', motivo: 'sin_plantilla' });
    aviso.mockRestore();
  });

  it('la cola vacía devuelve null sin hacer nada', async () => {
    const { salidas } = armar();
    expect(await salidas.tick()).toBeNull();
  });

  it('el recordatorio y su envío recorren el camino entero hasta Graph', async () => {
    const redis = crearRedisFalso();
    const enviados = [];
    const outbox = crearOutbox({
      redis,
      enviar: async (m) => { enviados.push(m); },
      colas: () => [colaDe(PHONE_ID)],
    });
    const salidas = crearSalidas({ redis, outbox, tenants: tenantsDeObjeto(TENANTS) });

    await redis.lPush(COLA_SALIDAS, JSON.stringify(RECORDATORIO));
    await salidas.tick();
    const r = await outbox.tick();

    expect(r.resultado).toBe('entregado');
    expect(enviados[0]).toMatchObject({ plantilla: 'recordatorio_turno', telefono: CLIENTE });
  });
});
