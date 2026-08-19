/**
 * Salidas proactivas: lo que el core quiere mandar sin que el cliente escriba.
 *
 * El core (E7: recordatorio 24hs antes, hueco liberado) hace LPUSH en la lista
 * `salidas_whatsapp` y se olvida. Acá se consume con BRPOP y se pasa al mismo
 * outbox que usa el webhook — una sola puerta de salida hacia Meta, un solo
 * lugar donde mirar cuando algo no llegó.
 *
 * Payload (contrato de E7):
 *   { negocio_id, wa_phone_id, telefono, tipo: "texto"|"plantilla",
 *     texto?, plantilla?, variables?, compromiso_id? }
 *
 * Ojo con la ventana de 24hs: pasada esa ventana Meta sólo acepta plantillas
 * aprobadas. Un `tipo: "texto"` proactivo va a rebotar casi siempre; el core
 * manda plantilla para eso y el rebote termina en la DLQ del outbox, visible.
 */

export const COLA_SALIDAS = 'salidas_whatsapp';

/**
 * @param {object} opts
 * @param {object} opts.redis
 * @param {object} opts.outbox  { encolar }
 * @param {object} opts.tenants
 * @param {string} [opts.cola]
 */
export function crearSalidas({
  redis,
  // Igual que en el outbox: el BRPOP quiere su propia conexión.
  redisBloqueante = redis,
  outbox,
  tenants,
  cola = COLA_SALIDAS,
} = {}) {
  let corriendo = false;
  let bucle = null;

  /** @returns {Promise<{estado: string, motivo?: string}>} */
  async function procesar(crudo) {
    let p;
    try {
      p = typeof crudo === 'string' ? JSON.parse(crudo) : crudo;
    } catch (err) {
      console.error('[salidas] JSON ilegible descartado: %s', err.message);
      return { estado: 'ilegible' };
    }

    const phoneNumberId = p?.wa_phone_id;
    const telefono = p?.telefono;
    if (!phoneNumberId || !telefono) {
      console.error('[salidas] payload sin wa_phone_id o telefono — descarto');
      return { estado: 'invalido', motivo: 'faltan_campos' };
    }

    // El tenant tiene que existir: si no, no sabemos con qué token ni con qué
    // número mandar. Es un error de configuración, no tráfico ajeno como en el
    // webhook, así que se loguea fuerte.
    if (!tenants.porPhoneId(phoneNumberId)) {
      console.error(
        '[salidas] el core pidió mandar por %s pero no está en tenants.json — descarto',
        phoneNumberId,
      );
      return { estado: 'tenant_desconocido' };
    }

    const tipo = p.tipo === 'plantilla' ? 'plantilla' : 'texto';
    if (tipo === 'plantilla' && !p.plantilla) {
      console.error('[salidas] tipo plantilla sin nombre — descarto');
      return { estado: 'invalido', motivo: 'sin_plantilla' };
    }

    await outbox.encolar({
      phone_number_id: phoneNumberId,
      telefono,
      tipo,
      texto: p.texto,
      plantilla: p.plantilla,
      variables: p.variables,
      idioma: p.idioma,
      negocio_id: p.negocio_id,
      id: p.compromiso_id ? `salida:${p.compromiso_id}:${p.plantilla || 'texto'}` : undefined,
    });
    return { estado: 'encolado' };
  }

  /** Un ciclo: espera un payload y lo encola. Para tests. */
  async function tick(timeoutSeg = 1) {
    const res = await redisBloqueante.brPop(cola, timeoutSeg);
    if (!res) return null;
    return procesar(res.element ?? res[1]);
  }

  function arrancar() {
    if (corriendo) return;
    corriendo = true;
    bucle = (async () => {
      while (corriendo) {
        try {
          await tick();
        } catch (err) {
          if (!corriendo) break;
          console.error('[salidas] error en el worker: %s', err.message);
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    })();
  }

  async function detener() {
    corriendo = false;
    await bucle?.catch(() => {});
    bucle = null;
  }

  return { procesar, tick, arrancar, detener, cola };
}
