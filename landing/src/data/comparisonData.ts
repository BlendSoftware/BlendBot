import { ComparisonItem, PillarData } from '../types';

export const PILLARS_DATA: PillarData[] = [
  {
    number: '01',
    tag: 'EL AGENTE CONVERSACIONAL',
    title: 'Tu WhatsApp atiende como el mejor mozo del salón.',
    subtitle: 'Cero menús rígidos de árbol. Entiende lenguaje natural rioplatense, audios, errores de tipeo y gustos del cliente.',
    description: 'No le hace perder tiempo al comensal con "Presione 1 para ver la carta". Responde preguntas de ingredientes, coordina envíos con geolocalización, sugiere maridajes y toma reservas de mesa según la ocupación real.',
    bulletPoints: [
      'Entiende audios de WhatsApp con ruido ambiente de fondo',
      'Calcula costos de envío por dirección y zona en segundos',
      'Confirma alérgenos, puntos de cocción y notas a cocina ("sin cebolla", "bien cocido")',
      'Atiende 50 conversaciones en simultáneo a las 21:30 hs sin demorarse un segundo'
    ],
    quote: 'El cliente que espera 7 minutos en WhatsApp le pide al local de enfrente. Con BlendBot el primer bocado empieza en 2 segundos.',
    quoteAuthor: 'Lautaro — Fundador BlendBot',
    visualType: 'whatsapp',
    stats: {
      label: 'Tiempo de respuesta',
      value: '< 1.8 seg'
    }
  },
  {
    number: '02',
    tag: 'LA TABLET DE DESPACHO',
    title: 'Se opera con el pulgar. Alto contraste para cocina con grasa.',
    subtitle: 'El interruptor de disponible ("SE ACABÓ") es la función más sagrada del sistema.',
    description: 'Diseñado específicamente para el cocinero y el cajero: parado, tablet llena de harina o grasa, viernes a la noche con gritos. Botones de más de 48px, cero menús ocultos y un switch colosal que apaga cualquier plato del bot en 1 segundo.',
    bulletPoints: [
      'Estados por color y posición (Pendiente ámbar, Marchando azul, Listo verde)',
      'Un solo toque en "SE ACABÓ" apaga el plato en WhatsApp al instante',
      'Selector de demora global: avisale a todos los clientes que la cocina tiene 25 min extra con 1 click',
      'Tablero en tiempo real visible a 1.5 metros de distancia con reflejos'
    ],
    quote: 'Si se acabó la bondiola a las 22:00, no podés ponerte a editar un catálogo web. Tocás la pantalla y el bot ya sabe.',
    quoteAuthor: 'Jefe de Cocina — Piloto Palermo',
    visualType: 'tablet',
    stats: {
      label: 'Toques para pausar un plato',
      value: '1 toque'
    }
  },
  {
    number: '03',
    tag: 'FACTURACIÓN FISCAL ARCA',
    title: 'Cobrás la comanda y el comprobante de ARCA sale solo.',
    subtitle: 'Desde el 1/7/2026 la factura electrónica es obligatoria en Argentina. Chau cargar tickets a mano en AFIP a las 2 AM.',
    description: 'Conectado directo al web service oficial de ARCA (ex AFIP) mediante sidecar homologado. Emite Factura A, B y Comprobantes C con CAE válido, código QR fiscal y envío automático al WhatsApp del cliente si lo solicita.',
    bulletPoints: [
      'Cumple 100% la normativa fiscal obligatoria 2026',
      'Emisión en menos de 900ms por comanda cobrada',
      'Cierre X y Z diario consolidado con totalización de medios de pago',
      'Cero desvíos: nunca más una diferencia entre lo que vendiste y lo que facturaste'
    ],
    quote: 'Facturar a mano a la 1 de la mañana después de 8 horas de despacho es inhumano. Ahora sale con un toque.',
    quoteAuthor: 'Dueño de Pizzería — Usuario BlendBot',
    visualType: 'arca',
    stats: {
      label: 'Tiempo de emisión fiscal',
      value: '820 ms'
    }
  }
];

export const COMPARISON_DATA: ComparisonItem[] = [
  {
    feature: 'Comisión por pedido vendido',
    category: 'Económico',
    blendbot: { status: true, text: '0% de comisión (Abono fijo en $)', highlight: true },
    pedidosYa: { status: false, text: '25% a 35% + IVA por ticket' },
    genericBot: { status: true, text: '0% (pero no toma comandas)' },
    manual: { status: true, text: '0% (pero perdés el 30% de clientes)' },
  },
  {
    feature: 'Sabe el stock real de la cocina',
    category: 'Operativo',
    blendbot: { status: true, text: 'Sí, sincronizado con el botón "SE ACABÓ"', highlight: true },
    pedidosYa: { status: false, text: 'Lento de pausar en el portal' },
    genericBot: { status: false, text: 'No, lee PDF o catálogo estático' },
    manual: { status: true, text: 'El mozo/cajero lo sabe de memoria' },
  },
  {
    feature: 'Facturación obligatoria ARCA (AFIP)',
    category: 'Fiscal',
    blendbot: { status: true, text: 'Automática al cobrar en el panel', highlight: true },
    pedidosYa: { status: false, text: 'Facturan su comisión, vos facturás el resto a mano' },
    genericBot: { status: false, text: 'No existe integración fiscal' },
    manual: { status: false, text: 'Manual en la web de AFIP a las 2 AM' },
  },
  {
    feature: 'Comprensión de audios y lenguaje natural',
    category: 'IA & WhatsApp',
    blendbot: { status: true, text: 'IA rioplatense (audios, modismos, notas)', highlight: true },
    pedidosYa: { status: false, text: 'App fija, no hay WhatsApp nativo' },
    genericBot: { status: false, text: 'Menús rígidos ("Escriba 1 para ver menú")' },
    manual: { status: true, text: 'Humano (pero demora 15 minutos en contestar)' },
  },
  {
    feature: 'Base de datos y clientes propios',
    category: 'Negocio',
    blendbot: { status: true, text: 'Tus clientes son 100% tuyos en tu WhatsApp', highlight: true },
    pedidosYa: { status: false, text: 'El cliente es de la plataforma, no tuyo' },
    genericBot: { status: true, text: 'Tus contactos' },
    manual: { status: true, text: 'Chats desordenados en un teléfono' },
  }
];
