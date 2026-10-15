import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { crearAgente, AgenteTimeout } from '../src/agente.js';
import { crearSesiones, claveChat } from '../src/sesiones.js';
import { TENANTS, PHONE_ID, CLIENTE } from './ayudas/payloads.js';

const TENANT = { phone_number_id: PHONE_ID, ...TENANTS[PHONE_ID] };
const CLAVE = claveChat(PHONE_ID, CLIENTE);

let dir;
let config;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agente-'));
  config = {
    raizRepo: '/repo',
    coreUrl: 'http://core.test',
    modelo: 'claude-haiku-4-5-20251001',
    borradoresDir: path.join(dir, 'borradores'),
  };
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** Stream falso del SDK: la secuencia de mensajes que devolvería query(). */
function streamDe(mensajes) {
  return (async function* () {
    for (const m of mensajes) yield m;
  })();
}

function textoAsistente(texto) {
  return { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: texto }] } };
}

function armar({ mensajes, queryFn } = {}) {
  const sesiones = crearSesiones({ dir });
  const espia = vi.fn(async () => streamDe(mensajes || [
    { type: 'system', subtype: 'init', session_id: 'ses-nueva' },
    textoAsistente('Hola, ¿para qué día lo querés?'),
    { type: 'result', subtype: 'success', session_id: 'ses-nueva' },
  ]));
  const agente = crearAgente({
    config,
    sesiones,
    queryFn: queryFn || espia,
    leerSkill: (v) => `# SKILL de ${v}`,
  });
  return { agente, sesiones, espia };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('la query que se arma', () => {
  it('junta el texto de los bloques del asistente', async () => {
    const { agente } = armar({
      mensajes: [
        { type: 'system', session_id: 'ses-1' },
        textoAsistente('Dale, '),
        { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'mcp__copiloto__huecos' }] } },
        textoAsistente('tengo el jueves a las 10:30.'),
        { type: 'result', session_id: 'ses-1' },
      ],
    });
    const r = await agente.responder({ tenant: TENANT, telefono: CLIENTE, texto: 'turno?', clave: CLAVE });
    expect(r.texto).toBe('Dale, tengo el jueves a las 10:30.');
  });

  it('el systemPrompt es el SKILL.md del vertical del tenant', async () => {
    const { agente, espia } = armar();
    await agente.responder({ tenant: TENANT, telefono: CLIENTE, texto: 'hola', clave: CLAVE });
    expect(espia.mock.calls[0][0].options.systemPrompt).toBe('# SKILL de gastronomia');
  });

  it('el MCP se levanta con el token del negocio y el teléfono del cliente', async () => {
    const { agente, espia } = armar();
    await agente.responder({ tenant: TENANT, telefono: CLIENTE, texto: 'hola', clave: CLAVE });

    const { mcpServers } = espia.mock.calls[0][0].options;
    expect(mcpServers.copiloto.command).toBe('uv');
    expect(mcpServers.copiloto.args).toEqual(['--directory', '/repo/agente', 'run', 'python', 'server.py']);
    expect(mcpServers.copiloto.env).toMatchObject({
      CORE_URL: 'http://core.test',
      AGENTE_TOKEN: 'cop_token_de_prueba',
      CLIENTE_TELEFONO: CLIENTE,
    });
  });

  it('el entorno del MCP incluye BORRADORES_DIR y sigue sin ANTHROPIC_* ni META_*', async () => {
    const { agente, espia } = armar();
    await agente.responder({ tenant: TENANT, telefono: CLIENTE, texto: 'hola', clave: CLAVE });

    const { env } = espia.mock.calls[0][0].options.mcpServers.copiloto;
    expect(env.BORRADORES_DIR).toBe(config.borradoresDir);
    for (const clave of Object.keys(env)) {
      expect(clave.startsWith('ANTHROPIC_')).toBe(false);
      expect(clave.startsWith('META_')).toBe(false);
    }
  });

  it('dos tenants distintos nunca comparten token en la misma corrida', async () => {
    const { agente, espia } = armar();
    const otro = { ...TENANT, agente_token: 'cop_otro_negocio' };
    await agente.responder({ tenant: TENANT, telefono: CLIENTE, texto: 'a', clave: 'a:1' });
    await agente.responder({ tenant: otro, telefono: '5490000000', texto: 'b', clave: 'b:1' });

    const tokens = espia.mock.calls.map((c) => c[0].options.mcpServers.copiloto.env.AGENTE_TOKEN);
    expect(tokens).toEqual(['cop_token_de_prueba', 'cop_otro_negocio']);
  });

  it('el modelo sale de la config y las tools están acotadas al MCP', async () => {
    const { agente, espia } = armar();
    await agente.responder({ tenant: TENANT, telefono: CLIENTE, texto: 'hola', clave: CLAVE });
    const { options } = espia.mock.calls[0][0];
    expect(options.model).toBe('claude-haiku-4-5-20251001');
    expect(options.allowedTools).toEqual(['mcp__copiloto']);
    // Nada de CLAUDE.md ni skills del disco de la máquina.
    expect(options.settingSources).toEqual([]);
  });

  it('un vertical sin SKILL.md falla con un mensaje que se entiende', async () => {
    const sesiones = crearSesiones({ dir });
    const agente = crearAgente({
      config, sesiones, queryFn: vi.fn(),
      leerSkill: () => { throw new Error('ENOENT'); },
    });
    await expect(agente.responder({
      tenant: { ...TENANT, vertical: 'kiosco' }, telefono: CLIENTE, texto: 'x', clave: CLAVE,
    })).rejects.toThrow(/vertical "kiosco"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('sesiones: resume', () => {
  it('la primera vez no manda resume y guarda el session_id', async () => {
    const { agente, sesiones, espia } = armar();
    const r = await agente.responder({ tenant: TENANT, telefono: CLIENTE, texto: 'hola', clave: CLAVE });

    expect(espia.mock.calls[0][0].options.resume).toBeUndefined();
    expect(r.reanudo).toBe(false);
    expect(sesiones.obtener(CLAVE)).toBe('ses-nueva');
  });

  it('la segunda vez reanuda con el session_id guardado', async () => {
    const { agente, espia } = armar();
    await agente.responder({ tenant: TENANT, telefono: CLIENTE, texto: 'hola', clave: CLAVE });
    const r = await agente.responder({ tenant: TENANT, telefono: CLIENTE, texto: 'el jueves', clave: CLAVE });

    expect(espia.mock.calls[1][0].options.resume).toBe('ses-nueva');
    expect(r.reanudo).toBe(true);
  });

  it('la sesión sobrevive a un restart del gateway', async () => {
    const { agente } = armar();
    await agente.responder({ tenant: TENANT, telefono: CLIENTE, texto: 'hola', clave: CLAVE });

    // Proceso nuevo, mismo SESIONES_DIR.
    const sesiones2 = crearSesiones({ dir });
    const espia2 = vi.fn(async () => streamDe([textoAsistente('sigo'), { type: 'result', session_id: 'ses-nueva' }]));
    const agente2 = crearAgente({ config, sesiones: sesiones2, queryFn: espia2, leerSkill: () => '#' });

    await agente2.responder({ tenant: TENANT, telefono: CLIENTE, texto: '¿seguís ahí?', clave: CLAVE });
    expect(espia2.mock.calls[0][0].options.resume).toBe('ses-nueva');
  });

  it('si la sesión guardada ya no existe en el motor, la olvida y arranca una nueva', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { agente, sesiones } = armar();
    sesiones.guardar(CLAVE, 'ses-perdida');
    let llamadas = 0;
    const queryFn = vi.fn(async ({ options }) => {
      llamadas += 1;
      if (options.resume === 'ses-perdida') {
        return (async function* () { throw new Error('Claude Code returned an error result: No conversation found with session ID: ses-perdida'); })();
      }
      return streamDe([textoAsistente('hola de nuevo'), { type: 'result', session_id: 'ses-otra' }]);
    });
    const agente2 = crearAgente({ config, sesiones, queryFn, leerSkill: () => '#' });

    const r = await agente2.responder({ tenant: TENANT, telefono: CLIENTE, texto: 'hola', clave: CLAVE });
    expect(r.texto).toBe('hola de nuevo');
    expect(llamadas).toBe(2);
    expect(queryFn.mock.calls[1][0].options.resume).toBeUndefined();
    expect(sesiones.obtener(CLAVE)).toBe('ses-otra');
    void agente;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('timeout y errores', () => {
  it('a los N ms aborta y tira AgenteTimeout', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const queryFn = vi.fn(async ({ options }) => (async function* () {
      await new Promise((_r, rechazar) => {
        options.abortController.signal.addEventListener('abort', () => rechazar(new Error('aborted')));
      });
      yield textoAsistente('nunca llega');
    })());

    const sesiones = crearSesiones({ dir });
    const agente = crearAgente({ config, sesiones, queryFn, timeoutMs: 20, leerSkill: () => '#' });

    await expect(agente.responder({ tenant: TENANT, telefono: CLIENTE, texto: 'hola', clave: CLAVE }))
      .rejects.toBeInstanceOf(AgenteTimeout);
  });

  it('el AbortController le llega al SDK', async () => {
    const { agente, espia } = armar();
    await agente.responder({ tenant: TENANT, telefono: CLIENTE, texto: 'hola', clave: CLAVE });
    expect(espia.mock.calls[0][0].options.abortController).toBeInstanceOf(AbortController);
  });

  it('un error del SDK se propaga tal cual (no se disfraza de timeout)', async () => {
    const queryFn = vi.fn(async () => { throw new Error('529 overloaded'); });
    const sesiones = crearSesiones({ dir });
    const agente = crearAgente({ config, sesiones, queryFn, leerSkill: () => '#' });

    await expect(agente.responder({ tenant: TENANT, telefono: CLIENTE, texto: 'hola', clave: CLAVE }))
      .rejects.toThrow('529 overloaded');
    expect(sesiones.obtener(CLAVE)).toBeNull();
  });

  it('si el modelo no dice nada, devuelve texto vacío y el webhook se disculpa', async () => {
    const { agente } = armar({ mensajes: [{ type: 'result', session_id: 'ses-x' }] });
    const r = await agente.responder({ tenant: TENANT, telefono: CLIENTE, texto: 'hola', clave: CLAVE });
    expect(r.texto).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Caso de producción del 15/10: en una conversación reanudada de ~40 turnos,
// gemini-2.5-flash-lite afirmó "Ya está en el local" sin haber llamado
// `confirmar`. El cliente creyó que pidió y el local nunca se enteró.
describe('guarda: no mandar una confirmación o un precio sin la tool que los respalda', () => {
  const TEXTO_SEGURO = 'Perdón, no pude registrar tu pedido todavía. ¿Me lo repetís así lo cargo?';

  function toolUse(nombre) {
    return { type: 'assistant', message: { content: [{ type: 'tool_use', name: nombre }] } };
  }

  it('afirma confirmación sin tool → reintenta con sesión nueva; si el reintento usa confirmar, se manda esa', async () => {
    let llamada = 0;
    const queryFn = vi.fn(async ({ options }) => {
      llamada += 1;
      if (llamada === 1) {
        return streamDe([
          textoAsistente('Listo, tu pedido ya está en el local.'),
          { type: 'result', session_id: 'ses-1' },
        ]);
      }
      return streamDe([
        toolUse('mcp__copiloto__confirmar'),
        textoAsistente('Confirmado, tu pedido ya está en el local.'),
        { type: 'result', session_id: 'ses-2' },
      ]);
    });
    const { agente } = armar({ queryFn });

    const r = await agente.responder({ tenant: TENANT, telefono: CLIENTE, texto: 'dale, confirmalo', clave: CLAVE });

    expect(llamada).toBe(2);
    expect(queryFn.mock.calls[1][0].options.resume).toBeUndefined();
    expect(r.texto).toBe('Confirmado, tu pedido ya está en el local.');
  });

  it('las dos respuestas afirman sin tool → texto seguro', async () => {
    const queryFn = vi.fn(async () => streamDe([
      textoAsistente('Ya está en el local, lo estamos preparando.'),
      { type: 'result', session_id: 'ses-1' },
    ]));
    const { agente } = armar({ queryFn });

    const r = await agente.responder({ tenant: TENANT, telefono: CLIENTE, texto: 'confirmalo', clave: CLAVE });

    expect(queryFn.mock.calls.length).toBe(2);
    expect(r.texto).toBe(TEXTO_SEGURO);
  });

  it('respuesta con tool confirmar → pasa sin tocar', async () => {
    const queryFn = vi.fn(async () => streamDe([
      toolUse('mcp__copiloto__confirmar'),
      textoAsistente('Confirmado, ya está en el local.'),
      { type: 'result', session_id: 'ses-1' },
    ]));
    const { agente } = armar({ queryFn });

    const r = await agente.responder({ tenant: TENANT, telefono: CLIENTE, texto: 'confirmalo', clave: CLAVE });

    expect(queryFn.mock.calls.length).toBe(1);
    expect(r.texto).toBe('Confirmado, ya está en el local.');
  });

  it('precio sin tool de catálogo → reintenta', async () => {
    let llamada = 0;
    const queryFn = vi.fn(async () => {
      llamada += 1;
      return streamDe([
        textoAsistente('La pizza sale $8500.'),
        { type: 'result', session_id: `ses-${llamada}` },
      ]);
    });
    const { agente } = armar({ queryFn });

    const r = await agente.responder({ tenant: TENANT, telefono: CLIENTE, texto: '¿cuánto sale?', clave: CLAVE });

    expect(llamada).toBe(2);
    expect(r.texto).toBe(TEXTO_SEGURO);
  });

  it('precio con ver_catalogo de por medio → pasa sin tocar', async () => {
    const queryFn = vi.fn(async () => streamDe([
      toolUse('mcp__copiloto__ver_catalogo'),
      textoAsistente('La pizza sale $8500.'),
      { type: 'result', session_id: 'ses-1' },
    ]));
    const { agente } = armar({ queryFn });

    const r = await agente.responder({ tenant: TENANT, telefono: CLIENTE, texto: '¿cuánto sale?', clave: CLAVE });

    expect(queryFn.mock.calls.length).toBe(1);
    expect(r.texto).toBe('La pizza sale $8500.');
  });

  it('respuesta normal, sin afirmaciones ni precios → pasa sin tocar', async () => {
    const { agente } = armar({
      mensajes: [textoAsistente('Hola, ¿qué querés pedir?'), { type: 'result', session_id: 'ses-1' }],
    });

    const r = await agente.responder({ tenant: TENANT, telefono: CLIENTE, texto: 'hola', clave: CLAVE });

    expect(r.texto).toBe('Hola, ¿qué querés pedir?');
  });
});
