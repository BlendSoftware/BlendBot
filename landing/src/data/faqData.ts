import { FaqItem } from '../types';

export const FAQ_DATA: FaqItem[] = [
  {
    category: 'whatsapp',
    question: '¿Tengo que cambiar mi número de WhatsApp actual?',
    answer: 'No. BlendBot se conecta directamente a la línea oficial de WhatsApp que tu local ya tiene y que tus clientes ya conocen. No perdés tus contactos ni tu historial, y podés seguir atendiendo manualmente cuando quieras.'
  },
  {
    category: 'operaciones',
    question: '¿Qué pasa si se corta internet o la luz en el local?',
    answer: 'BlendBot opera en la nube con redundancia 24/7. Si tu local tiene una interrupción momentánea, el bot sigue recibiendo las consultas, guardando las comandas y avisando automáticamente a los clientes del estado de demora hasta que vuelva la conexión de tu tablet.'
  },
  {
    category: 'arca',
    question: '¿Cómo funciona la conexión con ARCA (ex AFIP)? ¿Es seguro?',
    answer: 'La conexión se realiza mediante los certificados fiscales oficiales de ARCA (Delegación de Servicios con Clave Fiscal Nivel 3). Los certificados quedan encriptados en un sidecar aislado. BlendBot sólo tiene permisos para emitir comprobantes de venta de tu local, sin acceso a tus cuentas bancarias ni declaraciones juradas.'
  },
  {
    category: 'operaciones',
    question: '¿Necesito comprar tablets caras o equipos especiales?',
    answer: 'Para nada. El panel de despacho corre sobre cualquier navegador web moderno (Chrome, Safari) en cualquier tablet Android, iPad, notebook o pantalla táctil que ya tengas en el mostrador. No requiere hardware propietario ni costoso.'
  },
  {
    category: 'precios',
    question: '¿Cobran algún porcentaje o comisión sobre mis ventas?',
    answer: 'Cero. En BlendBot estamos en contra del modelo de comisiones del 25-35% de las apps de delivery. Pagás un abono mensual fijo y plano en pesos argentinos. Toda la plata de tus pedidos y comandas va 100% directa a tu caja o cuenta bancaria.'
  },
  {
    category: 'operaciones',
    question: '¿Cuánto tiempo tarda la puesta en marcha de mi local?',
    answer: 'En menos de 48 horas dejamos cargada tu carta, configurado el número de WhatsApp oficial, vinculado el certificado de ARCA y capacitado a tu equipo de cocina y mostrador (que aprenden a usarlo en 5 minutos).'
  }
];
