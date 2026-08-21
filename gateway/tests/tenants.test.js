import { describe, it, expect } from 'vitest';
import path from 'node:path';

import { cargarTenants, tenantsDeObjeto } from '../src/tenants.js';
import { cargarConfig, validarConfig } from '../src/config.js';
import { RAIZ_GATEWAY } from '../src/config.js';

const BASE = {
  '106540352242922': {
    negocio: 'Rotisería de prueba',
    agente_token: 'cop_abc123',
    vertical: 'gastronomia',
    wa_numero: '+5492611234567',
  },
};

describe('tenants.json', () => {
  it('resuelve el negocio por phone_number_id', () => {
    const t = tenantsDeObjeto(BASE);
    expect(t.porPhoneId('106540352242922')).toMatchObject({
      negocio: 'Rotisería de prueba', agente_token: 'cop_abc123', vertical: 'gastronomia',
    });
  });

  it('un phone_number_id desconocido devuelve null, no explota', () => {
    expect(tenantsDeObjeto(BASE).porPhoneId('999')).toBeNull();
  });

  it('acepta el id como número o como string', () => {
    const t = tenantsDeObjeto(BASE);
    expect(t.porPhoneId(106540352242922)).not.toBeNull();
  });

  it('lista los phone_number_id para armar las colas del outbox', () => {
    expect(tenantsDeObjeto(BASE).phoneIds()).toEqual(['106540352242922']);
  });

  it('falla si falta un campo obligatorio', () => {
    expect(() => tenantsDeObjeto({ '1': { negocio: 'x', vertical: 'gastronomia' } }))
      .toThrow(/agente_token/);
  });

  it('rechaza un JWT del panel donde va el token de agente', () => {
    expect(() => tenantsDeObjeto({ '1': { negocio: 'x', vertical: 'gastronomia', agente_token: 'eyJhbGciOi' } }))
      .toThrow(/cop_/);
  });

  it('un archivo que no existe falla con la ruta en el mensaje', () => {
    expect(() => cargarTenants('/no/existe/tenants.json')).toThrow(/tenants.json/);
  });

  it('el tenants.example.json del repo es válido', () => {
    const t = cargarTenants(path.join(RAIZ_GATEWAY, 'tenants.example.json'));
    expect(t.cantidad).toBe(2);
    expect(t.todos().map((x) => x.vertical)).toEqual(['gastronomia', 'gastronomia']);
  });
});

describe('config', () => {
  it('tiene los defaults del contrato', () => {
    const c = cargarConfig({});
    expect(c.puerto).toBe(8090);
    expect(c.modelo).toBe('claude-haiku-4-5-20251001');
    expect(c.coreUrl).toBe('http://localhost:8080');
    expect(c.tenantsPath.endsWith('tenants.json')).toBe(true);
    expect(c.sesionesDir.endsWith(path.join('data', 'sesiones'))).toBe(true);
  });

  it('el entorno pisa los defaults', () => {
    const c = cargarConfig({ PORT: '9000', MODELO: 'claude-sonnet-4-6', REDIS_URL: 'redis://otro:6379' });
    expect(c.puerto).toBe(9000);
    expect(c.modelo).toBe('claude-sonnet-4-6');
    expect(c.redisUrl).toBe('redis://otro:6379');
  });

  it('no arranca sin los secretos: un gateway sin app secret acepta cualquier webhook', () => {
    expect(() => validarConfig(cargarConfig({}))).toThrow(/META_APP_SECRET/);
  });

  it('con todo puesto valida', () => {
    const c = cargarConfig({
      META_APP_SECRET: 's', META_VERIFY_TOKEN: 'v', META_GRAPH_TOKEN: 'g', ANTHROPIC_API_KEY: 'k',
    });
    expect(validarConfig(c)).toBe(c);
  });
});
