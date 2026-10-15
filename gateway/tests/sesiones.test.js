import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { crearSesiones, claveChat, TTL_MS, MAX_TURNOS } from '../src/sesiones.js';

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sesiones-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('claveChat', () => {
  it('separa la misma persona en dos comercios distintos', () => {
    expect(claveChat('111', '5492611111111')).not.toBe(claveChat('222', '5492611111111'));
    expect(claveChat('111', '5492611111111')).toBe('111:5492611111111');
  });
});

describe('persistencia', () => {
  it('guarda y devuelve el resumeId', () => {
    const s = crearSesiones({ dir });
    s.guardar('111:549261', 'ses-abc');
    expect(s.obtener('111:549261')).toBe('ses-abc');
  });

  it('devuelve null si nunca hubo sesión', () => {
    expect(crearSesiones({ dir }).obtener('nada:nadie')).toBeNull();
  });

  it('write-through: el archivo queda escrito en el acto', () => {
    const s = crearSesiones({ dir });
    s.guardar('111:549261', 'ses-abc');
    const enDisco = JSON.parse(fs.readFileSync(s.ruta, 'utf8'));
    expect(enDisco['111:549261'].resumeId).toBe('ses-abc');
  });

  it('sobrevive a un restart del proceso (el gotcha de wa-claude)', () => {
    const antes = crearSesiones({ dir });
    antes.guardar('111:549261', 'ses-abc');
    antes.guardar('222:549262', 'ses-def');

    const despues = crearSesiones({ dir });
    expect(despues.obtener('111:549261')).toBe('ses-abc');
    expect(despues.obtener('222:549262')).toBe('ses-def');
    expect(despues.cantidad).toBe(2);
  });

  it('pisa el resumeId cuando el SDK devuelve uno nuevo', () => {
    const s = crearSesiones({ dir });
    s.guardar('111:549261', 'ses-1');
    s.guardar('111:549261', 'ses-2');
    expect(s.obtener('111:549261')).toBe('ses-2');
    expect(s.cantidad).toBe(1);
  });

  it('un archivo corrupto no tumba el gateway: arranca vacío', () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'sesiones.json'), '{ esto no es json');
    const s = crearSesiones({ dir });
    expect(s.cantidad).toBe(0);
    s.guardar('111:549261', 'ses-nueva');
    expect(s.obtener('111:549261')).toBe('ses-nueva');
  });

  it('borrar saca la sesión del disco también', () => {
    const s = crearSesiones({ dir });
    s.guardar('111:549261', 'ses-abc');
    s.borrar('111:549261');
    expect(s.obtener('111:549261')).toBeNull();
    expect(JSON.parse(fs.readFileSync(s.ruta, 'utf8'))).toEqual({});
  });
});

describe('expiración a las 2hs', () => {
  it('el TTL por defecto son 2hs', () => {
    expect(TTL_MS).toBe(2 * 60 * 60 * 1000);
  });

  it('vence sola después del TTL de inactividad', () => {
    let t = 1_000_000;
    const s = crearSesiones({ dir, ahora: () => t });
    s.guardar('111:549261', 'ses-abc');

    t += TTL_MS - 1000;
    expect(s.obtener('111:549261')).toBe('ses-abc');

    t += 2000; // pasadas las 24hs
    expect(s.obtener('111:549261')).toBeNull();
  });

  it('tocar renueva la ventana sin cambiar el resumeId', () => {
    let t = 1_000_000;
    const s = crearSesiones({ dir, ahora: () => t });
    s.guardar('111:549261', 'ses-abc');

    t += TTL_MS - 1000;
    s.tocar('111:549261');
    t += TTL_MS - 1000;

    expect(s.obtener('111:549261')).toBe('ses-abc');
  });

  it('purgar limpia las vencidas y deja las vivas', () => {
    let t = 1_000_000;
    const s = crearSesiones({ dir, ahora: () => t });
    s.guardar('vieja:1', 'ses-vieja');
    t += TTL_MS + 1;
    s.guardar('nueva:1', 'ses-nueva');

    expect(s.purgar()).toBe(1);
    expect(s.cantidad).toBe(1);
    expect(s.obtener('nueva:1')).toBe('ses-nueva');
    expect(Object.keys(JSON.parse(fs.readFileSync(s.ruta, 'utf8')))).toEqual(['nueva:1']);
  });

  it('la sesión vencida también desaparece del disco', () => {
    let t = 1_000_000;
    const s = crearSesiones({ dir, ahora: () => t });
    s.guardar('111:549261', 'ses-abc');
    t += TTL_MS + 1;
    s.obtener('111:549261');
    expect(JSON.parse(fs.readFileSync(s.ruta, 'utf8'))).toEqual({});
  });
});

describe('tope de turnos por sesión', () => {
  it('el tope por defecto es 20', () => {
    expect(MAX_TURNOS).toBe(20);
  });

  it('al llegar al tope, no reanuda aunque esté dentro del TTL', () => {
    const s = crearSesiones({ dir, maxTurnos: 3 });
    s.guardar('111:549261', 'ses-abc'); // turno 1
    s.guardar('111:549261', 'ses-abc'); // turno 2
    s.guardar('111:549261', 'ses-abc'); // turno 3 — llegó al tope
    expect(s.obtener('111:549261')).toBeNull();
  });

  it('por debajo del tope sigue reanudando', () => {
    const s = crearSesiones({ dir, maxTurnos: 3 });
    s.guardar('111:549261', 'ses-abc'); // turno 1
    s.guardar('111:549261', 'ses-abc'); // turno 2
    expect(s.obtener('111:549261')).toBe('ses-abc');
  });

  it('una sesión nueva (resumeId distinto) resetea el contador de turnos', () => {
    const s = crearSesiones({ dir, maxTurnos: 2 });
    s.guardar('111:549261', 'ses-vieja'); // turno 1
    s.guardar('111:549261', 'ses-vieja'); // turno 2 — llegó al tope
    expect(s.obtener('111:549261')).toBeNull();

    s.guardar('111:549261', 'ses-nueva'); // conversación nueva, turno 1 de nuevo
    expect(s.obtener('111:549261')).toBe('ses-nueva');
  });

  it('un registro viejo sin contador se sigue leyendo bien', () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'sesiones.json'),
      JSON.stringify({ '111:549261': { resumeId: 'ses-vieja', ultimoUso: Date.now() } }),
    );
    const s = crearSesiones({ dir });
    expect(s.obtener('111:549261')).toBe('ses-vieja');
  });
});
