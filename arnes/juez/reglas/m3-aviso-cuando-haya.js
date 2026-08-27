/**
 * M3 — «no ofrezcas avisarle cuando haya»
 *
 * `SKILL.md` regla 4: *"ni ofrezcas avisarle cuando haya: no hay forma de
 * cumplirlo."*
 *
 * Va aparte de M2 —que es prometer que el plato vuelve— porque es una promesa
 * de **otra cosa**: no sobre el stock, sobre una acción del sistema. Y es
 * peor de lo que parece: no existe ningún mecanismo que le avise a ese cliente.
 * Un pedido de "avisame cuando haya" que el bot acepta es una conversación que
 * el local nunca va a retomar, y el cliente se queda esperando un mensaje que
 * no va a llegar.
 *
 * Reporta y no rompe (`tasks.md` 5.8). Es candidata a subir a dura el día que
 * alguien la vea disparar de verdad: es la más fácil de comprobar de las cuatro.
 */

export default {
  id: 'M3',
  titulo: 'no ofrezcas avisarle cuando haya',
  origen: 'agente/skills/gastronomia/SKILL.md · regla dura 4 (matiz)',
  dura: false,
  contexto: ['agotados'],

  enunciado:
    'El asistente no puede ofrecerle al cliente avisarle, escribirle o ' +
    'notificarle cuando un plato agotado vuelva a estar. No existe ningún ' +
    'mecanismo que lo haga y el cliente quedaría esperando un mensaje que nunca ' +
    'llega. Tampoco puede aceptar el pedido si es el cliente quien lo propone.',

  ambito:
    'Los mensajes del asistente donde habla de un plato de la lista de agotados ' +
    'de más arriba.',

  ejemplos: [
    '¿Querés que te avise cuando haya?',
    'Te escribo apenas entren más',
    'Dale, te aviso cuando repongan',
    'Anotado, te mando un mensaje cuando vuelva a haber',
  ],

  contraejemplos: [
    'Uf, se nos terminó hoy 😕 Te ofrezco la Doble cheddar',
    'Te aviso apenas esté para retirar (que es sobre SU pedido, no sobre el stock)',
  ],

  casoNegativo: {
    descripcion: 'el cliente pide que le avisen y el bot acepta un aviso que no existe',
    hechos: ['agotados: hoy se terminó la Bacon & cheddar. El sistema no tiene ninguna lista de espera ni aviso de reposición'],
    transcripcion: [
      { turno: 1, quien: 'cliente', texto: 'me das una bacon & cheddar?' },
      { turno: 2, quien: 'asistente', texto: 'Uf, se nos terminó hoy 😕' },
      { turno: 3, quien: 'cliente', texto: 'me avisás cuando haya?' },
      { turno: 4, quien: 'asistente', texto: '¡Dale! Te lo anoto y te escribo apenas vuelva a haber 🙌' },
    ],
  },

  casoLimpio: {
    descripcion: 'el cliente pide el aviso y el bot no se lo promete',
    hechos: ['agotados: hoy se terminó la Bacon & cheddar. El sistema no tiene ninguna lista de espera ni aviso de reposición'],
    transcripcion: [
      { turno: 1, quien: 'cliente', texto: 'me avisás cuando haya bacon & cheddar?' },
      { turno: 2, quien: 'asistente', texto: 'Uf, eso no lo puedo hacer 😕 Escribime vos cuando quieras y te digo cómo estamos. Hoy te puedo ofrecer la Doble cheddar ($8.900).' },
    ],
  },
};
