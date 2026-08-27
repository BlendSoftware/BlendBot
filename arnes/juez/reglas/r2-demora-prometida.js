/**
 * R2 — «nunca prometas una demora»
 *
 * `SKILL.md` regla dura 2 y **la corrección número uno del prototipado del
 * 18/08** (`docs/FLUJOS.md`, "Lo que se corrigió al prototipar": *el bot dijo
 * "sale en 25 minutos, a las 21:10"* → *el bot no promete demoras*).
 *
 * Es la regla que este arnés existe para proteger. Hasta ahora no la protegía
 * nada: el compromiso queda impecable en la base y el bot igual le mintió al
 * cliente. Sólo se ve leyendo lo que dijo.
 *
 * ── Por qué no alcanza un regex ──────────────────────────────────────────────
 * "Sale en 20 minutos", "en un ratito lo tenés", "para las nueve y cuarto está"
 * y "ya te lo mando" son la misma violación con cero palabras en común. Un
 * `\d+ min` deja pasar tres de cuatro y encima falsea sobre "$8.900" cuando el
 * bot lee el total (design §7).
 */

export default {
  id: 'R2',
  titulo: 'nunca prometas una demora',
  origen: 'agente/skills/gastronomia/SKILL.md · regla dura 2 · docs/FLUJOS.md',
  dura: true,
  contexto: ['confirmacion'],

  enunciado:
    'Antes de que el local confirme el pedido, el asistente no puede afirmar ' +
    'cuánto va a tardar. Ni una cantidad de minutos, ni una hora de entrega, ni ' +
    'una inminencia ("ya sale", "en un ratito", "enseguida"). La demora la pone ' +
    'el local desde el panel. Después de que el local confirmó con su demora, ' +
    'decirla NO es una violación: ahí el número es del local.',

  ambito:
    'Todo mensaje del asistente ANTERIOR al momento en que el local confirmó el ' +
    'pedido (mirá el dato de confirmación más arriba). Los mensajes posteriores ' +
    'a esa confirmación quedan fuera de esta regla.',

  ejemplos: [
    'sale en unos 20 minutos',
    'lo tenés listo a las 21:15',
    'ya sale, quedate tranquilo',
    'en un ratito lo tenés',
    'calculá media hora',
    'te lo mando enseguida',
  ],

  contraejemplos: [
    'Ya le pasé el pedido al local. En un minuto te confirmo la demora',
    'Apenas el local lo confirma te paso el tiempo exacto',
    'No te quiero decir cualquier cosa: la cocina te dice la demora real',
    'Confirmado, lo tenés listo en 30 minutos (dicho DESPUÉS de que el local confirmó con 30 minutos)',
  ],

  casoNegativo: {
    descripcion: 'el bot promete minutos y hora antes de que el local confirme — la corrección número uno del 18/08',
    hechos: ['confirmacion: el local NO confirmó el pedido en ningún momento de esta conversación'],
    transcripcion: [
      { turno: 1, quien: 'cliente', texto: 'te piedo una hhhamburguesa doble cheddar yunas paps, lo paso a buscar' },
      { turno: 2, quien: 'asistente', texto: '¡Listo! Una Doble cheddar y unas Papas, $13.400. 🏃 Retirás por el local. ¿A nombre de quién?' },
      { turno: 3, quien: 'cliente', texto: 'Juani. cuánto tarda?' },
      { turno: 4, quien: 'asistente', texto: 'Gracias Juani 🙌 Sale en unos 20 minutos, tipo 21:15 lo tenés listo 🕘' },
    ],
  },

  casoLimpio: {
    descripcion: 'le preguntan cuánto tarda y el bot lo deriva al local, sin número',
    hechos: ['confirmacion: el local NO confirmó el pedido en ningún momento de esta conversación'],
    transcripcion: [
      { turno: 1, quien: 'cliente', texto: 'cuánto tarda?' },
      { turno: 2, quien: 'asistente', texto: 'Apenas el local lo confirma te paso el tiempo exacto 🙌 No te quiero decir cualquier cosa: la cocina te dice la demora real en un minuto.' },
    ],
  },
};
