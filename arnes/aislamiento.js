/**
 * aislamiento.js — cada corrida se crea su propio local.
 *
 * Es el mismo patrón que `scripts/smoke.sh` ya justificó y que ya funciona:
 * sufijo al azar, alta del negocio, primer login del dueño, cambio de
 * contraseña obligatorio y rotación del token del agente. Correrlo diez veces
 * deja diez parrillas de prueba en la base de desarrollo y ningún error.
 *
 * Se copia ese patrón en vez de inventar otro por dos razones: ya está probado
 * contra el core real, y limpiar es el paso más frágil de todos — una corrida
 * que borra lo que creó se lleva puesta la evidencia de la falla que acababa de
 * encontrar. Acá no se borra nada (spec: "Sin limpieza al terminar").
 *
 * El gotcha que se cobra la segunda corrida:
 * `wa_phone_id` es **UNIQUE** en la migración `000001`. Sin sufijo, la primera
 * corrida pasa y la segunda choca con un 409 que no dice nada. Por eso el
 * phone id, el usuario del dueño y el teléfono del cliente llevan el mismo
 * sufijo: dos corridas simultáneas no se ven entre sí.
 */

import { entorno, ErrorArnes } from './entorno.js';

/** La misma zona que usa el smoke. Un local con horarios y demoras vive en su hora. */
export const TIMEZONE = 'America/Argentina/Mendoza';

// ── Cliente HTTP del core ────────────────────────────────────────────────────

/**
 * Cliente mínimo contra la API del core. Devuelve status y cuerpo parseado
 * SIEMPRE: el arnés necesita leer el cuerpo de los errores para poder contar
 * qué pasó, así que nada tira por status.
 *
 * @param {string} base  ej. http://localhost:8080
 */
export function crearApi(base) {
  /**
   * @param {'GET'|'POST'|'PATCH'|'PUT'|'DELETE'} metodo
   * @param {string} ruta   ej. /api/servicios
   * @param {string} [token]  Bearer: JWT del panel o `cop_...` del agente
   * @param {object} [cuerpo]
   * @returns {Promise<{status: number, json: any, texto: string}>}
   */
  return async function api(metodo, ruta, token = '', cuerpo = undefined) {
    const opciones = {
      method: metodo,
      headers: {},
      signal: AbortSignal.timeout(30000),
    };
    if (token) opciones.headers.Authorization = `Bearer ${token}`;
    if (cuerpo !== undefined) {
      opciones.headers['Content-Type'] = 'application/json';
      opciones.body = JSON.stringify(cuerpo);
    }

    let res;
    try {
      res = await fetch(`${base}${ruta}`, opciones);
    } catch (err) {
      throw new ErrorArnes(
        `el core no contestó a ${metodo} ${ruta}: ${err?.cause?.code || err?.message || err}`,
        `¿sigue arriba el compose? docker compose ps`,
      );
    }

    const texto = await res.text();
    let json = null;
    try {
      json = texto ? JSON.parse(texto) : null;
    } catch {
      json = null; // no todo lo que devuelve el core es JSON (204, errores de proxy)
    }
    return { status: res.status, json, texto };
  };
}

/**
 * Exige un status. Un fallo del alta es **arnés roto**, no producto roto: el
 * arnés no llegó a preguntarle nada al bot, así que no tiene veredicto que dar.
 */
function exigir(res, esperado, que) {
  if (res.status === esperado) return res.json;
  throw new ErrorArnes(
    `${que}: esperaba HTTP ${esperado}, llegó ${res.status}`,
    `cuerpo: ${res.texto.slice(0, 500)}`,
  );
}

// ── El alta de la corrida ────────────────────────────────────────────────────

/** Nueve dígitos al azar. Sirve de sufijo para el usuario, el phone id y el teléfono. */
function sufijoAlAzar() {
  return String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
}

/**
 * Crea el local de esta corrida y devuelve todo lo que hace falta para
 * manejarlo: los tokens de los tres accesos (admin, dueño, agente), el phone id
 * que va a llevar el tenant en memoria del gateway, y el teléfono del cliente.
 *
 * @param {object} [opts]
 * @param {ReturnType<typeof entorno>} [opts.env]
 * @param {string} [opts.sufijo]  para reproducir una corrida a mano
 * @param {string} [opts.timezone]
 * @param {object} [opts.config]  config del negocio; se mergea sobre el default
 * @returns {Promise<object>} la corrida
 */
export async function crearCorrida(opts = {}) {
  const env = opts.env || entorno();
  const api = crearApi(env.coreUrl);
  const sufijo = opts.sufijo || sufijoAlAzar();
  const timezone = opts.timezone || TIMEZONE;

  const nombreNegocio = `Parrilla Arnés ${sufijo}`;
  const usuarioDueno = `arnes${sufijo}`;
  const passwordDueno = `arnes-clave-${sufijo}`; // el core exige 8 caracteres

  // El `phone_number_id` es opaco para todo el sistema: el de Meta es numérico,
  // pero nada valida el formato y uno reconocible hace que una corrida
  // abandonada se encuentre de un vistazo, en la base y en las colas de redis.
  const waPhoneId = `arnes-${sufijo}`;
  // Formato de móvil argentino, como el smoke: 54 9 261 + 5 dígitos del sufijo.
  const telefonoCliente = `54926110${sufijo.slice(0, 5)}`;

  // 1. El admin de la plataforma. Es el único que puede dar de alta un negocio
  //    y rotar el token del agente.
  const login = await api('POST', '/api/auth/login', '', {
    username: env.adminUsuario,
    password: env.adminPassword,
  });
  if (login.status === 401) {
    throw new ErrorArnes(
      `el admin de la plataforma no pudo entrar (usuario ${env.adminUsuario})`,
      'ADMIN_PASSWORD sale del .env de la raíz (o del default del compose).',
      'Si la base ya tenía un admin, la contraseña es la de ESE alta: el bootstrap no la pisa.',
    );
  }
  const tokenAdmin = exigir(login, 200, 'login del admin').access_token;

  // 2. El negocio. `confirmacion.pedido = "humana"` es lo que hace que el bot
  //    NO confirme solo: sin eso, el escenario del dueño confirmando con demora
  //    no existe, que es la mitad del valor del producto (docs/FLUJOS.md).
  const config = {
    confirmacion: { pedido: 'humana' },
    ...(opts.config || {}),
  };
  const alta = await api('POST', '/api/admin/negocios', tokenAdmin, {
    nombre: nombreNegocio,
    vertical: 'gastronomia',
    timezone,
    usuario_dueno: usuarioDueno,
    wa_phone_id: waPhoneId,
    config,
  });
  const negocio = exigir(alta, 201, 'alta del negocio de la corrida');
  const negocioId = negocio.negocio_id;
  const passwordTemporal = negocio.password_temporal;
  if (!passwordTemporal) {
    throw new ErrorArnes('el alta del negocio no devolvió la contraseña temporal del dueño');
  }

  // 3. `wa_phone_id` no vuelve en la respuesta del alta, y sin él el core NO
  //    encola ningún aviso: `aviso_repo` filtra por `n.wa_phone_id IS NOT NULL`.
  //    Si se hubiera perdido, el escenario fallaría con "el cliente nunca
  //    recibió la confirmación" y la tarde se iría buscándolo en el bot.
  await verificarPhoneId({ api, tokenAdmin, negocioId, waPhoneId });

  // 4. El dueño entra y cambia la contraseña. No es un rodeo: el panel obliga a
  //    hacerlo en el primer login, así que el actor dueño del navegador va a
  //    pasar por esta misma pantalla (tarea 3.2).
  const loginTmp = await api('POST', '/api/auth/login', '', {
    username: usuarioDueno,
    password: passwordTemporal,
  });
  const tmp = exigir(loginTmp, 200, 'primer login del dueño');
  if (tmp.usuario?.must_change_password !== true) {
    throw new ErrorArnes('el dueño recién creado no viene obligado a cambiar la contraseña');
  }
  exigir(
    await api('POST', '/api/auth/cambiar-password', tmp.access_token, { password_nueva: passwordDueno }),
    200,
    'cambio de contraseña del dueño',
  );
  const loginDef = await api('POST', '/api/auth/login', '', {
    username: usuarioDueno,
    password: passwordDueno,
  });
  const tokenDueno = exigir(loginDef, 200, 'login del dueño con la contraseña nueva').access_token;

  // 5. El token del agente: la credencial con la que el MCP entra al core, y lo
  //    único que impide que un negocio lea a otro. Se rota siempre porque el
  //    alta no lo devuelve.
  const rot = await api('POST', `/api/admin/negocios/${negocioId}/token-agente`, tokenAdmin, {});
  const tokenAgente = exigir(rot, 200, 'rotación del token del agente').token;
  if (!String(tokenAgente).startsWith('cop_')) {
    // `tenantsDeObjeto` lo rechaza y el MCP también: mejor enterarse acá que en
    // el arranque del gateway, con un mensaje que no nombra la corrida.
    throw new ErrorArnes(
      `el token del agente no arranca con cop_: ${String(tokenAgente).slice(0, 12)}…`,
      'un JWT del panel no sirve: el agente se autentica como negocio.',
    );
  }

  return {
    sufijo,
    timezone,
    negocioId,
    nombreNegocio,
    usuarioDueno,
    passwordDueno,
    waPhoneId,
    telefonoCliente,
    tokenAdmin,
    tokenDueno,
    tokenAgente,
    api,
    coreUrl: env.coreUrl,
    panelUrl: env.panelUrl,

    /**
     * El tenant tal como lo espera `tenantsDeObjeto` de `gateway/src/tenants.js`.
     * Lo consume `gateway-en-proceso.js`: sin archivo `tenants.json` y sin
     * reiniciar contenedores.
     */
    tenant() {
      return {
        [waPhoneId]: {
          negocio: nombreNegocio,
          agente_token: tokenAgente,
          vertical: 'gastronomia',
        },
      };
    },
  };
}

/**
 * El core no expone `GET /api/admin/negocios/:id`, así que el phone id se lee
 * del listado. Es una llamada de más y vale lo que cuesta: es la diferencia
 * entre fallar acá con una línea clara y fallar tres minutos después con "el
 * cliente nunca recibió nada".
 */
async function verificarPhoneId({ api, tokenAdmin, negocioId, waPhoneId }) {
  const res = await api('GET', '/api/admin/negocios', tokenAdmin);
  const lista = exigir(res, 200, 'listado de negocios de la plataforma');
  const mio = (Array.isArray(lista) ? lista : []).find((n) => n?.id === negocioId);
  if (!mio) {
    throw new ErrorArnes(`el negocio ${negocioId} no aparece en el listado del admin`);
  }
  if (mio.wa_phone_id !== waPhoneId) {
    throw new ErrorArnes(
      `el negocio quedó con wa_phone_id ${mio.wa_phone_id ?? 'null'} en vez de ${waPhoneId}`,
      'sin wa_phone_id el core no encola ningún aviso y el cliente nunca recibe la confirmación.',
    );
  }
}
