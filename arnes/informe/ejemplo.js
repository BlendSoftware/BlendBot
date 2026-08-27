/**
 * La salida del arnés, sin correr el arnés.
 *
 *   node arnes/informe/ejemplo.js verde
 *   node arnes/informe/ejemplo.js rojo
 *   node arnes/informe/ejemplo.js arnes
 *
 * Es una bitácora de mentira con la forma exacta que llena el runner de verdad:
 * el Flujo A de `docs/FLUJOS.md`, con la frase mal escrita del documento y con
 * el error que el prototipado del 18/08 corrigió («sale en 25 minutos, a las
 * 21:10»).
 *
 * *Para qué sirve:* para poder discutir y arreglar **cómo se lee una falla** sin
 * levantar el compose, sin `uv` y sin gastar un peso. El formato de la salida es
 * el entregable del grupo 4; si sólo se lo puede ver corriendo una conversación
 * real, nadie lo va a mirar dos veces y va a envejecer mal. Con reloj fijo, dos
 * corridas del ejemplo dan byte por byte lo mismo, así que un cambio de formato
 * se ve en un diff.
 *
 * No prueba nada del producto y no tiene que hacerlo.
 */

import path from 'node:path';
import process from 'node:process';

import { ErrorArnes, RAIZ } from '../entorno.js';
import { crearInforme } from '../informe.js';

// Reloj congelado: el ejemplo tiene que dar siempre lo mismo.
const reloj = { t: Date.parse('2026-08-26T23:12:04-03:00') };
const ahora = () => reloj.t;
const av = (ms) => { reloj.t += ms; };

const CARTA = {
  'Doble cheddar': 8900,
  Papas: 4500,
};

function pedidoFeliz(informe, { conFalla, juezSinCita = false }) {
  const b = informe.escenario({
    escenario: 'pedido-feliz',
    etiquetas: ['@rapido'],
    corrida: { negocioId: 'ngc_7f21', waPhoneId: '5551234567-arnes-9c02', telefonoCliente: '+549341500009c02' },
  });

  b.sistema('negocio creado, carta cargada, token de agente rotado (cop_…)');
  av(400);

  b.cliente('Hola');
  av(2100);
  const t2 = b.bot('¡Hola! Soy el asistente del local, atiendo las 24hs.\n¿Qué necesitás?\n 1  Hacer un pedido\n 2  Reservar mesa\n 3  Ver la carta');
  t2.tool({
    nombre: 'mcp__copiloto__datos_del_negocio',
    argumentos: {},
    resultado: { nombre: 'Arnés Burger', vertical: 'gastronomia', confirmacion: { pedido: 'humana' } },
  });
  av(1800);

  b.cliente('te piedo una hhhamburguesa doble cheddar yunas paps, lo paso a buscar');
  av(3200);
  const t4 = b.bot(
    conFalla
      ? '¡Listo! Te lo armo así:\n\n 1×  Doble cheddar   $8.900\n 1×  Papas          $4.500\n ────────────────────────\n Total            $13.400\n\n🏃 Retirás por el local\n\nSale en 25 minutos, a las 21:10 🕘\n¿A nombre de quién?'
      : '¡Listo! Te lo armo así:\n\n 1×  Doble cheddar   $8.900\n 1×  Papas          $4.500\n ────────────────────────\n Total            $13.400\n\n🏃 Retirás por el local\n\n(Las papas te las puse comunes. Si las querés con cheddar y bacon son $1.300 más, avisame.)\n\n¿A nombre de quién?',
  );
  t4.tool({
    nombre: 'mcp__copiloto__ver_catalogo',
    argumentos: { categoria: null },
    resultado: { servicios: [{ nombre: 'Doble cheddar', precio: 8900, agotado: false }, { nombre: 'Papas', precio: 4500, agotado: false }] },
  });
  t4.tool({
    nombre: 'mcp__copiloto__armar_compromiso',
    argumentos: {
      tipo: 'pedido',
      entrega: 'retira',
      lineas: [{ servicio: 'Doble cheddar', cantidad: 1 }, { servicio: 'Papas', cantidad: 1 }],
    },
    resultado: { compromiso_id: 'cmp_4b19', estado: 'pendiente', total: conFalla ? 12100 : 13400 },
  });

  b.ok({
    nivel: 2,
    turno: t4,
    que: 'el bot consultó la carta antes de decir un precio — no lo dijo de memoria',
    origen: 'SKILL.md: no inventar precios',
  });
  b.asercion({
    ok: !conFalla,
    nivel: 1,
    turno: t4,
    que: 'el total que el bot le mostró al cliente es el que quedó en el core',
    esperado: CARTA['Doble cheddar'] + CARTA.Papas,
    llego: conFalla ? 12100 : 13400,
    origen: 'FLUJOS.md flujo A — "Confirma el resumen antes de cerrar, siempre con el total"',
    dondeMirar: 'GET /api/compromisos/cmp_4b19',
  });
  b.ok({
    nivel: 1,
    turno: t4,
    que: 'el pedido entró al panel como PENDIENTE mientras el cliente todavía escribe',
    origen: 'FLUJOS.md flujo A — "La cocina lo ve venir mientras el tipo todavía escribe"',
  });
  av(2400);

  b.cliente('Juani');
  av(1900);
  const t6 = b.bot('Gracias Juani 🙌\nYa le pasé el pedido al local. En un minuto te confirmo la demora.');
  b.ok({
    nivel: 2,
    turno: t6,
    que: 'el bot NO llamó a confirmar: el pedido lo confirma una persona',
    origen: 'SKILL.md: nunca confirmes vos un pedido',
  });
  av(5200);

  b.dueno({
    gesto: 'confirmó el pedido escribiendo 35 minutos en el campo libre (no es ninguno de los presets)',
    detalle: { compromiso_id: 'cmp_4b19', demora_min: 35, via: 'api' },
  });
  av(700);

  b.sistema('el aviso recorrió core → salidas_whatsapp → worker → outbox → Graph falso');
  av(900);
  const t9 = b.bot('✅ ¡Confirmado, Juani!\nTu pedido ya está en cocina. Lo tenés listo a las 21:20 🕘\nTe aviso apenas esté para retirar.');
  b.ok({
    nivel: 1,
    turno: t9,
    que: 'el cliente recibió el aviso con la demora que puso el dueño, por el Graph falso y no por la cola',
    origen: 'FLUJOS.md — "El aviso de vuelta es la mitad del valor"',
  });

  b.veredicto({
    regla: 'R2',
    texto: 'nunca prometas una demora',
    origen: 'SKILL.md regla 2',
    dura: true,
    votos: conFalla
      ? [
        { condena: true, cita: 'Sale en 25 minutos, a las 21:10', turno: t4, razon: 'afirma un tiempo antes de que el local confirme' },
        { condena: true, cita: 'Sale en 25 minutos, a las 21:10', turno: t4, razon: 'promete una hora de entrega por su cuenta' },
        { condena: true, cita: 'Sale en 25 minutos, a las 21:10', turno: t4 },
      ]
      : [{ condena: false }, { condena: false }, { condena: false }],
  });
  // Regla de matiz: aunque la condenen, NO rompe. Se ve, se cita, y no corta el
  // release. Sólo rompen las seis innegociables del SKILL.md.
  b.veredicto({
    regla: 'R8',
    texto: 'no repreguntes lo que el cliente ya dijo',
    origen: 'FLUJOS.md principio 3',
    dura: false,
    votos: conFalla
      ? [
        { condena: true, cita: '¿A nombre de quién?', turno: t4, razon: 'el cliente no se había presentado todavía, pero ya había dicho que retira' },
        { condena: true, cita: '¿A nombre de quién?', turno: t4 },
        { condena: false },
      ]
      : [{ condena: false }, { condena: true, cita: '¿A nombre de quién?', turno: t4, razon: 'ya se había presentado' }, { condena: false }],
  });

  // Y el caso que NO es falla del producto aunque el juez condene: condenó sin
  // citar una frase que aparezca en la transcripción. El juez alucinó, y una
  // alucinación no puede poner nada en rojo. La regla queda no evaluable y eso
  // es arnés roto, exit 2.
  if (juezSinCita) {
    b.veredicto({
      regla: 'R4',
      texto: 'no ofrezcas lo que no está en la carta',
      origen: 'SKILL.md regla 4',
      dura: true,
      votos: [
        { condena: true, cita: 'te puedo agregar unos aros de cebolla', turno: t4, razon: 'ofreció algo que no está en la carta' },
        { condena: true, razon: 'me parece que ofreció de más' },
        { condena: false },
      ],
    });
  }

  b.estadoCore({
    compromisos: [{ id: 'cmp_4b19', estado: conFalla ? 'confirmado' : 'confirmado', total: conFalla ? 12100 : 13400, demora_min: 35, lineas: [{ servicio: 'Doble cheddar', cantidad: 1, nota: null }, { servicio: 'Papas', cantidad: 1, nota: null }] }],
    stock: [{ servicio: 'Doble cheddar', restante: 11, agotado: false }],
    consultas: [],
    cobros: [],
  });
  b.gasto({ actor: 'bot', usd: null, nota: 'lo sirvió un agente leyendo agente/skills/gastronomia/SKILL.md' });
  b.gasto({ actor: 'juez', usd: 0.0143 });
  return b;
}

function pendiente(informe) {
  const b = informe.escenario({ escenario: 'insumo-compartido', etiquetas: ['@pendiente'] });
  b.marcarPendiente('espera el cambio `insumos-y-recetas`: vender un bife tiene que bajar las empanadas posibles');
  return b;
}

async function main() {
  const modo = (process.argv[2] || 'verde').toLowerCase();
  if (!['verde', 'rojo', 'arnes'].includes(modo)) {
    console.error('uso: node arnes/informe/ejemplo.js [verde|rojo|arnes]');
    process.exit(64);
  }

  const informe = crearInforme({
    modelos: {
      bot: 'claude-sonnet-4-5 (servido por un agente leyendo el SKILL.md, no por la API — design §1)',
      juez: 'claude-opus-4-1-20250805',
    },
    duenoModo: 'api (desatendido)',
    topeUsd: 1,
    corridaId: `ejemplo-${modo}`,
    dirSalida: path.join(RAIZ, 'arnes', 'salida'),
    ahora,
  });

  console.log(`Arnés · corrida ${informe.corridaId} · modo guion · dueño por API`);
  console.log('(ejemplo con reloj congelado: no levanta nada y no gasta un peso)');

  // Lo que esta corrida NO puede afirmar, con nombre y apellido (tarea 3.8).
  informe.omitida({
    que: 'el campo libre de la demora existe en la pantalla y acepta un valor que no es ningún preset',
    porque: 'sólo se ve en el panel; por API un PATCH con demora_min pasa igual, exista el campo o no',
    comoSeCubre: 'ARNES_DUENO=navegador — un agente ejecuta arnes/dueno/guion.md, paso 4',
    origen: 'D8: sin campo libre "el producto miente"',
  });
  informe.omitida({
    que: 'el pedido aparece en la pantalla del dueño sin recargar, mientras el cliente todavía escribe',
    porque: 'es render, no dato: por API el compromiso existe igual aunque la vista no se actualice',
    comoSeCubre: 'ARNES_DUENO=navegador — arnes/dueno/guion.md, paso 3',
    origen: 'FLUJOS.md flujo A — "La cocina lo ve venir mientras el tipo todavía escribe"',
  });

  await informe.cerrarEscenario(pedidoFeliz(informe, { conFalla: modo === 'rojo', juezSinCita: modo === 'arnes' }));
  await informe.cerrarEscenario(pendiente(informe));

  if (modo === 'arnes') {
    // Lo que rompe el arnés no es una aserción: es una afirmación sobre la
    // máquina. Sale por exit 2 y no dice NADA del producto.
    informe.romper(new ErrorArnes(
      'falta `uv` en el PATH y sin eso el MCP de agente/ no levanta',
      'instalalo: curl -LsSf https://astral.sh/uv/install.sh | sh',
      '',
      'Se detectó recién en el turno 6, así que la corrida quedó a mitad de camino.',
    ));
  }

  process.exit(await informe.cerrar());
}

main();
