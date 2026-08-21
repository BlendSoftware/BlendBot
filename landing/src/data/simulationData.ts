import { KitchenOrder, FiscalInvoice } from '../types';

export interface SimulationScenario {
  id: string;
  title: string;
  badge: string;
  description: string;
  clientMessage: string;
  botReply: string;
  order: KitchenOrder;
  invoice: FiscalInvoice;
  outOfStockExample?: {
    dishName: string;
    botAlternative: string;
  };
}

export const SIMULATION_SCENARIOS: SimulationScenario[] = [
  {
    id: 'delivery-custom',
    title: 'Pedido con Modificaciones',
    badge: 'DELIVERY · VIERNES 21:14 HS',
    description: 'Entiende pedidos largos en lenguaje coloquial rioplatense, adicionales y direcciones sin botones tontos.',
    clientMessage: 'Buenas! Me mandás 2 Dobles de Asado con queso ahumado y unas papas trufadas? A una no le pongas cebolla porfa. Es para Thames 1840, 3ro B.',
    botReply: '¡Marchando para Thames 1840, 3° B! 🍔 Total: $28.400 con envío. 1 Doble Asado completa + 1 Doble Asado SIN CEBOLLA + 1 Papas Trufadas. ¿Querés pagar con transferencia (Alias) o efectivo?',
    order: {
      id: 'CMD-8492',
      tableOrChannel: 'WhatsApp Delivery #01',
      clientName: 'Martín S. (Thames 1840)',
      time: '21:14 hs',
      status: 'pendiente',
      total: 28400,
      items: [
        { name: 'Doble Asado Ahumado', quantity: 1, price: 9800, notes: 'Completa', status: 'pending' },
        { name: 'Doble Asado Ahumado', quantity: 1, price: 9800, notes: '⚠️ SIN CEBOLLA', status: 'pending' },
        { name: 'Papas Trufadas & Parmesano', quantity: 1, price: 5800, status: 'pending' },
        { name: 'Envío Palermo Soho', quantity: 1, price: 3000, status: 'pending' },
      ],
    },
    invoice: {
      cae: '74391829304859',
      caeVto: '2026-08-31',
      ptoVta: '0004',
      cbteNro: '00008492',
      fecha: '21/08/2026 21:15',
      cuitEmisor: '30-71849201-9',
      razonSocial: 'BLEND GASTRONOMIA S.R.L.',
      importeTotal: 28400,
      ivaTotal: 4928.92,
      qrData: 'https://www.afip.gob.ar/fe/qr/?p=eyJ2ZXIiOjEsImZlY2hhIjoiMjAyNi0wOC0yMSIsImN1aXQiOjMwNzE4NDkyMDE5fQ==',
    }
  },
  {
    id: 'reserva-mesa',
    title: 'Reserva de Mesa en Turno Pico',
    badge: 'SALÓN · VIERNES 21:30 HS',
    description: 'Valida disponibilidad real de mesas por franja horaria en 1 segundo y confirma comensales.',
    clientMessage: 'Hola genios! ¿Tienen mesa para 4 hoy tipo 21:45? Es para festejar un cumple adentro.',
    botReply: '¡Hola! Sí, tengo la mesa 6 libre para 4 personas a las 21:45 adentro. Ya te la reservo a nombre de Juan Pablo. ¿Les guardo una botella de espumante fría para el brindis?',
    order: {
      id: 'RES-0142',
      tableOrChannel: 'Mesa 6 (Interior Salón)',
      clientName: 'Juan Pablo R. (Cumpleaños)',
      time: '21:45 hs',
      status: 'en-marcha',
      total: 0,
      items: [
        { name: 'Reserva 4 Comensales (Mesa 6)', quantity: 4, price: 0, notes: 'Cumpleaños / Adentro', status: 'cooking' },
        { name: 'Espumante de Bienvenida', quantity: 1, price: 0, notes: 'Cortesía de la casa', status: 'cooking' },
      ],
    },
    invoice: {
      cae: '74391829304910',
      caeVto: '2026-08-31',
      ptoVta: '0004',
      cbteNro: '00008493',
      fecha: '21/08/2026 21:45',
      cuitEmisor: '30-71849201-9',
      razonSocial: 'BLEND GASTRONOMIA S.R.L.',
      importeTotal: 0,
      ivaTotal: 0,
      qrData: 'https://www.afip.gob.ar/fe/qr/?p=eyJ2ZXIiOjEsImZlY2hhIjoiMjAyNi0wOC0yMSIsImN1aXQiOjMwNzE4NDkyMDE5fQ==',
    }
  },
  {
    id: 'agotado-vivo',
    title: 'Switch "Se Acabó" en Tiempo Real',
    badge: 'STOCK · REACCIÓN EN 1 SEG',
    description: 'Apagás un plato con un toque en la tablet y el bot ofrece alternativas automáticamente sin perder la venta.',
    clientMessage: 'Hola! Quiero pedir 2 Ojos de Bife madurados con puré trufado y un Malbec.',
    botReply: '¡Hola! Te cuento que recién sacamos el último Ojo de Bife y la cocina ya lo apagó del sistema. Pero te súper recomiendo la Entraña Criolla 450g al quebracho con el mismo puré trufado, está impecable. ¿Te la marcho?',
    order: {
      id: 'CMD-8495',
      tableOrChannel: 'WhatsApp Salón / Barra',
      clientName: 'Agustina V.',
      time: '21:22 hs',
      status: 'pendiente',
      total: 34200,
      isOutOfStockAlert: true,
      outOfStockDish: 'Ojo de Bife Madurado 600g',
      items: [
        { name: 'Entraña Criolla al Quebracho 450g (Reemplazo)', quantity: 2, price: 13500, notes: 'Punto Jugoso', status: 'pending' },
        { name: 'Puré Trufado', quantity: 2, price: 3600, status: 'pending' },
      ],
    },
    invoice: {
      cae: '74391829305011',
      caeVto: '2026-08-31',
      ptoVta: '0004',
      cbteNro: '00008495',
      fecha: '21/08/2026 21:23',
      cuitEmisor: '30-71849201-9',
      razonSocial: 'BLEND GASTRONOMIA S.R.L.',
      importeTotal: 34200,
      ivaTotal: 5935.53,
      qrData: 'https://www.afip.gob.ar/fe/qr/?p=eyJ2ZXIiOjEsImZlY2hhIjoiMjAyNi0wOC0yMSIsImN1aXQiOjMwNzE4NDkyMDE5fQ==',
    }
  }
];
