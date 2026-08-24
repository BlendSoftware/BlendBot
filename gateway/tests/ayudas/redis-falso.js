/**
 * Redis en memoria con el subconjunto que usa el gateway.
 *
 * Se prefirió esto a ioredis-mock por dos razones: el gateway usa `redis`
 * (node-redis v4, otra API) y porque los tests necesitan mirar adentro de las
 * colas (`lista()`) y controlar el tiempo del TTL sin dormir de verdad.
 *
 * Semántica que importa: se encola con lPush (izquierda) y se consume con
 * brPop (derecha) — o sea FIFO. rPush mete al frente de la fila de consumo,
 * que es lo que hace el reintento del outbox.
 *
 * Los sorted sets (zAdd/zRangeByScore/zRem) son el mínimo que necesita la cola
 * de reintentos del outbox: score = cuándo toca, miembro = el json del mensaje.
 */

export function crearRedisFalso({ ahora = () => Date.now() } = {}) {
  /** @type {Map<string, {valor: string, expiraEn: number|null}>} */
  const claves = new Map();
  /** @type {Map<string, string[]>} */
  const listas = new Map();
  /** @type {Map<string, Map<string, number>>} miembro → score */
  const zsets = new Map();

  function vigente(k) {
    const v = claves.get(k);
    if (!v) return null;
    if (v.expiraEn !== null && v.expiraEn <= ahora()) {
      claves.delete(k);
      return null;
    }
    return v;
  }

  return {
    async set(clave, valor, opciones = {}) {
      const existe = vigente(clave);
      if (opciones.NX && existe) return null;
      if (opciones.XX && !existe) return null;
      claves.set(clave, {
        valor: String(valor),
        expiraEn: opciones.EX ? ahora() + opciones.EX * 1000 : null,
      });
      return 'OK';
    },

    async get(clave) {
      return vigente(clave)?.valor ?? null;
    },

    async del(clave) {
      return claves.delete(clave) ? 1 : 0;
    },

    async ttl(clave) {
      const v = vigente(clave);
      if (!v) return -2;
      if (v.expiraEn === null) return -1;
      return Math.ceil((v.expiraEn - ahora()) / 1000);
    },

    async lPush(clave, valor) {
      const l = listas.get(clave) || [];
      l.unshift(String(valor));
      listas.set(clave, l);
      return l.length;
    },

    async rPush(clave, valor) {
      const l = listas.get(clave) || [];
      l.push(String(valor));
      listas.set(clave, l);
      return l.length;
    },

    /** Sin bloqueo real: si no hay nada, devuelve null en el acto. */
    async brPop(claveOClaves) {
      const objetivos = Array.isArray(claveOClaves) ? claveOClaves : [claveOClaves];
      for (const k of objetivos) {
        const l = listas.get(k);
        if (l && l.length) return { key: k, element: l.pop() };
      }
      return null;
    },

    async lLen(clave) {
      return (listas.get(clave) || []).length;
    },

    /** Acepta {score, value} o un array de esos, como node-redis v4. */
    async zAdd(clave, entradas) {
      const z = zsets.get(clave) || new Map();
      let nuevos = 0;
      for (const e of Array.isArray(entradas) ? entradas : [entradas]) {
        if (!z.has(String(e.value))) nuevos++;
        z.set(String(e.value), Number(e.score));
      }
      zsets.set(clave, z);
      return nuevos;
    },

    /** Miembros con score en [min, max], ordenados por score ascendente. */
    async zRangeByScore(clave, min, max) {
      const z = zsets.get(clave);
      if (!z) return [];
      return [...z.entries()]
        .filter(([, score]) => score >= min && score <= max)
        .sort((a, b) => a[1] - b[1])
        .map(([miembro]) => miembro);
    },

    async zRem(clave, miembro) {
      const z = zsets.get(clave);
      if (!z) return 0;
      return z.delete(String(miembro)) ? 1 : 0;
    },

    async zCard(clave) {
      return (zsets.get(clave) || new Map()).size;
    },

    // ── sólo para los tests ────────────────────────────────────────────────
    lista(clave) {
      return [...(listas.get(clave) || [])];
    },
    zsetJson(clave) {
      const z = zsets.get(clave) || new Map();
      return [...z.entries()]
        .sort((a, b) => a[1] - b[1])
        .map(([miembro, score]) => ({ score, item: JSON.parse(miembro) }));
    },
    listaJson(clave) {
      return this.lista(clave).map((s) => JSON.parse(s));
    },
    clavesVigentes() {
      return [...claves.keys()].filter((k) => vigente(k));
    },
    vaciar() {
      claves.clear();
      listas.clear();
      zsets.clear();
    },
  };
}
