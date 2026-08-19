/**
 * Tenants: de `phone_number_id` a negocio.
 *
 * El `phone_number_id` es lo único confiable que trae el webhook para saber a
 * quién le escribieron. De acá salen las dos cosas que definen la sesión: el
 * `agente_token` (con el que el MCP se autentica contra el core, y que es lo
 * que impide que un negocio lea a otro) y el `vertical` (qué SKILL.md se le
 * pone de systemPrompt al modelo).
 *
 * Un phone_number_id desconocido NO es un error del sistema: es tráfico que no
 * es nuestro. Se loguea y se descarta en silencio.
 */

import fs from 'node:fs';

const CAMPOS = ['negocio', 'agente_token', 'vertical'];

/**
 * @param {string} ruta  archivo tenants.json
 * @param {{lector?: (ruta: string) => string}} [deps]
 */
export function cargarTenants(ruta, deps = {}) {
  const leer = deps.lector || ((r) => fs.readFileSync(r, 'utf8'));

  let crudo;
  try {
    crudo = JSON.parse(leer(ruta));
  } catch (err) {
    throw new Error(`No pude leer tenants desde ${ruta}: ${err.message}`);
  }
  if (!crudo || typeof crudo !== 'object' || Array.isArray(crudo)) {
    throw new Error(`${ruta} tiene que ser un objeto { "<phone_number_id>": {...} }`);
  }

  const porId = new Map();
  for (const [phoneNumberId, t] of Object.entries(crudo)) {
    const faltan = CAMPOS.filter((c) => !t || !t[c]);
    if (faltan.length) {
      throw new Error(`Tenant ${phoneNumberId} incompleto: falta ${faltan.join(', ')}`);
    }
    if (!String(t.agente_token).startsWith('cop_')) {
      throw new Error(
        `Tenant ${phoneNumberId}: agente_token tiene que ser un token de agente (cop_...). ` +
        'Un JWT del panel no sirve: el agente se autentica como negocio.',
      );
    }
    porId.set(String(phoneNumberId), {
      phone_number_id: String(phoneNumberId),
      negocio: t.negocio,
      agente_token: t.agente_token,
      vertical: t.vertical,
      wa_numero: t.wa_numero || null,
    });
  }

  return {
    /** @returns {object|null} */
    porPhoneId(id) {
      return porId.get(String(id)) || null;
    },
    todos() {
      return [...porId.values()];
    },
    phoneIds() {
      return [...porId.keys()];
    },
    get cantidad() {
      return porId.size;
    },
  };
}

/** Registro vacío, para tests y para arrancar sin tenants todavía. */
export function tenantsDeObjeto(obj) {
  return cargarTenants('(memoria)', { lector: () => JSON.stringify(obj) });
}
