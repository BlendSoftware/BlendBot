import React, { useState } from 'react';
import { Power, Check, ShieldCheck, Receipt } from 'lucide-react';

export const EditorialPillars: React.FC = () => {
  const [meatStock, setMeatStock] = useState<boolean>(true);

  const toggleStock = () => {
    const next = !meatStock;
    setMeatStock(next);
  };

  return (
    <section id="rituales" className="py-16 sm:py-36 bg-dark border-b border-dark-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-8 lg:px-10">
        
        {/* Section Header */}
        <div className="max-w-3xl mb-12 sm:mb-28">
          <div className="font-ancha text-[9px] sm:text-xs text-terracota uppercase tracking-widest-editorial mb-2 sm:mb-3 font-bold flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-logo-gold" />
            <span>[ 02 // EL CIRCUITO OPERATIVO ]</span>
          </div>
          <h2 className="font-serif font-semibold text-tinta text-2xl xs:text-3xl sm:text-5xl lg:text-6xl leading-[1.05] tracking-tight">
            Tres engranajes en sintonía. <br />
            <span className="font-display font-bold uppercase tracking-tightest">
              Tu restaurante funcionando solo.
            </span>
          </h2>
          <p className="mt-3 sm:mt-4 text-sm sm:text-lg text-bone-muted font-sans font-normal">
            La atención por chat, el pase de cocina y la facturación fiscal sincronizados en tiempo real.
          </p>
        </div>

        {/* Pillars Stack */}
        <div className="space-y-16 sm:space-y-40">
          
          {/* =========================================================================
              RITUAL 01: LA CONVERSACIÓN
             ========================================================================= */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-16 items-center">
            
            {/* Left: Editorial Text (6 cols) */}
            <div className="lg:col-span-6 space-y-4 sm:space-y-6">
              <div className="flex items-center gap-3 sm:gap-4">
                <span className="font-ancha text-3xl sm:text-5xl font-semibold text-terracota">01</span>
                <div className="h-px flex-1 bg-dark-border" />
                <span className="font-ancha text-[9px] sm:text-[10px] uppercase tracking-widest text-bone-muted font-semibold">
                  El Asistente Inteligente
                </span>
              </div>

              <h3 className="font-serif font-semibold text-xl sm:text-4xl text-tinta leading-tight">
                Atención 24/7 en tu WhatsApp oficial.
              </h3>

              <p className="text-xs sm:text-base text-bone-muted leading-relaxed font-sans font-normal">
                No hay menús numéricos rígidos ni bots que confunden.
                BlendBot atiende consultas de carta y vinos, toma reservas para almuerzos, cenas o degustaciones
                y arma los pedidos con todo lo que el cliente necesita aclarar.
              </p>

              <div className="space-y-2 pt-1 sm:pt-2 font-ancha text-xs text-tinta">
                <div className="flex items-start gap-2">
                  <Check className="w-3.5 h-3.5 text-terracota mt-0.5 flex-shrink-0" />
                  <span>Entiende audios de WhatsApp y consultas de carta de vinos</span>
                </div>
                <div className="flex items-start gap-2">
                  <Check className="w-3.5 h-3.5 text-terracota mt-0.5 flex-shrink-0" />
                  <span>Confirma reservas según los turnos y capacidad real de tus mesas</span>
                </div>
                <div className="flex items-start gap-2">
                  <Check className="w-3.5 h-3.5 text-terracota mt-0.5 flex-shrink-0" />
                  <span>Atiende múltiples comensales en simultáneo en segundos</span>
                </div>
              </div>

              <blockquote className="p-3 sm:p-4 bg-dark-surface border-l-2 border-logo-gold font-serif text-xs sm:text-sm text-bone-muted">
                "El comensal local y el turista reciben respuesta inmediata sin hacer esperar a nadie."
              </blockquote>
            </div>

            {/* Right: Editorial Dialogue Card (Crisp White Paper, 6 cols) */}
            <div className="lg:col-span-6">
              <div className="bg-paper-pure text-tinta border border-paper-border p-4 sm:p-8 shadow-sm font-sans rounded-sm relative">
                
                <div className="flex items-center justify-between border-b border-paper-border pb-2.5 sm:pb-3 mb-3 sm:mb-4 font-ancha text-[10px] sm:text-[11px] text-tinta-muted">
                  <span className="text-tinta font-bold uppercase">WhatsApp // Servicio Noche</span>
                  <span>Mendoza · 21:14 hs</span>
                </div>

                <div className="space-y-3 sm:space-y-4 text-xs sm:text-sm">
                  {/* Guest Message */}
                  <div className="pl-3 sm:pl-4 border-l-2 border-paper-border text-tinta-muted">
                    <span className="font-ancha text-[9px] uppercase block mb-0.5 text-tinta-muted">Cliente</span>
                    <p className="font-serif text-tinta text-xs sm:text-base">
                      «Hola! Tienen mesa para 4 hoy tipo 21:30? Quisiéramos cenar adentro y probar la carta de fuegos.»
                    </p>
                  </div>

                  {/* Host Message */}
                  <div className="pl-3 sm:pl-4 border-l-2 border-logo-gold text-tinta bg-paper-warm p-3 sm:p-4 rounded-sm">
                    <div className="flex items-center gap-1.5 font-ancha text-[9px] sm:text-[10px] uppercase text-terracota font-bold mb-1">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>Respuesta en 1.2s · Mesa Asignada</span>
                    </div>
                    <p className="font-sans leading-relaxed text-xs sm:text-sm text-tinta">
                      ¡Buenas noches! Sí, tenemos la <strong className="text-terracota">Mesa 4</strong> disponible en el salón principal para 4 personas a las 21:30 hs. 🍷<br />
                      Ya te la reservo a tu nombre. ¿Les dejamos una copa de bienvenida reservada?
                    </p>
                  </div>
                </div>

                <div className="mt-3 sm:mt-4 pt-2.5 sm:pt-3 border-t border-paper-border flex justify-between items-center font-ancha text-[9px] sm:text-[10px] text-tinta-muted">
                  <span>NÚMERO OFICIAL DE TU LOCAL</span>
                  <span className="text-terracota font-bold">RESERVAS EN VIVO</span>
                </div>

              </div>
            </div>

          </div>


          {/* =========================================================================
              RITUAL 02: EL PULSO DEL DESPACHO & SWITCH "SE ACABÓ"
             ========================================================================= */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-16 items-center">
            
            {/* Visual Column */}
            <div className="lg:col-span-6 order-2 lg:order-1">
              <div className="bg-dark-surface border border-dark-border p-4 sm:p-8 shadow-sm rounded-sm">
                
                <div className="flex items-center justify-between border-b border-dark-border pb-2.5 sm:pb-3 mb-4 sm:mb-6 font-ancha text-[10px] sm:text-[11px] text-bone-muted">
                  <span className="text-tinta font-bold uppercase">Comandera // Stock en Vivo</span>
                  <span className="text-terracota font-bold">TOUCH ≥48PX</span>
                </div>

                {/* Interactive Stock Switch */}
                <div className="bg-dark-card border border-dark-border p-3.5 sm:p-5 space-y-3 sm:space-y-4 rounded-sm">
                  <div>
                    <span className="font-ancha text-[9px] sm:text-[10px] text-bone-muted uppercase tracking-wider block">PLATO DE COCINA</span>
                    <div className="font-serif font-bold text-base sm:text-xl text-tinta">
                      Ojo de Bife a la Brasa de Quebracho (600g)
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-3 border-t border-dark-border">
                    <div className="font-ancha text-xs">
                      {meatStock ? (
                        <span className="text-verde font-semibold flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-verde" /> DISPONIBLE EN CARTA
                        </span>
                      ) : (
                        <span className="text-terracota font-bold flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-terracota" /> SE ACABÓ (Pausado en WhatsApp)
                        </span>
                      )}
                    </div>

                    <button
                      onClick={toggleStock}
                      className={`w-full sm:w-auto px-4 py-3 font-ancha text-xs uppercase font-bold tracking-wider transition-all duration-200 active:scale-95 flex items-center justify-center gap-2 rounded-sm min-h-[44px] sm:min-h-[40px] ${
                        meatStock 
                          ? 'border border-dark-border text-tinta hover:border-terracota hover:text-terracota bg-dark' 
                          : 'bg-terracota text-white shadow-lg'
                      }`}
                    >
                      <Power className="w-3.5 h-3.5" />
                      <span>{meatStock ? 'Pausar Plato' : 'SE ACABÓ'}</span>
                    </button>
                  </div>
                </div>

                <p className="mt-3 sm:mt-4 font-ancha text-[10px] sm:text-[11px] text-bone-muted text-center">
                  Probá tocar el botón: el bot deja de ofrecer el plato en WhatsApp al instante.
                </p>

              </div>
            </div>

            {/* Text Column */}
            <div className="lg:col-span-6 order-1 lg:order-2 space-y-4 sm:space-y-6">
              <div className="flex items-center gap-3 sm:gap-4">
                <span className="font-ancha text-3xl sm:text-5xl font-semibold text-terracota">02</span>
                <div className="h-px flex-1 bg-dark-border" />
                <span className="font-ancha text-[9px] sm:text-[10px] uppercase tracking-widest text-bone-muted font-semibold">
                  La Comandera Táctil
                </span>
              </div>

              <h3 className="font-serif font-semibold text-xl sm:text-4xl text-tinta leading-tight">
                El interruptor que evita vender lo que no hay.
              </h3>

              <p className="text-xs sm:text-base text-bone-muted leading-relaxed font-sans font-normal">
                En pleno despacho de cocina, si se termina un plato o corte especial, 
                un solo toque en "SE ACABÓ" apaga el ítem en WhatsApp al segundo. 
                El bot sugiere alternativas y no tenés que ir a avisarle a los clientes que su pedido se canceló.
              </p>

              <div className="space-y-2 pt-1 sm:pt-2 font-ancha text-xs text-tinta">
                <div className="flex items-start gap-2">
                  <Check className="w-3.5 h-3.5 text-terracota mt-0.5 flex-shrink-0" />
                  <span>Se opera con el pulgar en cualquier tablet de cocina o barra</span>
                </div>
                <div className="flex items-start gap-2">
                  <Check className="w-3.5 h-3.5 text-terracota mt-0.5 flex-shrink-0" />
                  <span>Ajuste de demora general en cocina con un solo toque</span>
                </div>
              </div>
            </div>

          </div>


          {/* =========================================================================
              RITUAL 03: EL ACTO FISCAL
             ========================================================================= */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-16 items-center">
            
            {/* Left: Text Column (6 cols) */}
            <div className="lg:col-span-6 space-y-4 sm:space-y-6">
              <div className="flex items-center gap-3 sm:gap-4">
                <span className="font-ancha text-3xl sm:text-5xl font-semibold text-terracota">03</span>
                <div className="h-px flex-1 bg-dark-border" />
                <span className="font-ancha text-[9px] sm:text-[10px] uppercase tracking-widest text-bone-muted font-semibold">
                  Facturación Fiscal ARCA
                </span>
              </div>

              <h3 className="font-serif font-semibold text-xl sm:text-4xl text-tinta leading-tight">
                Cobrás la cuenta y la factura fiscal sale sola.
              </h3>

              <p className="text-xs sm:text-base text-bone-muted leading-relaxed font-sans font-normal">
                Cumplimiento obligatorio 2026 de factura electrónica para gastronomía en Argentina. 
                Conectado directo al web service oficial de ARCA: 
                al tocar "Cobrar", se emite la Factura A, B o C con CAE homologado y código QR en menos de 1 segundo.
              </p>

              <div className="space-y-2 pt-1 sm:pt-2 font-ancha text-xs text-tinta">
                <div className="flex items-start gap-2">
                  <Check className="w-3.5 h-3.5 text-terracota mt-0.5 flex-shrink-0" />
                  <span>Factura A, B y C automática sin entrar a la web de AFIP</span>
                </div>
                <div className="flex items-start gap-2">
                  <Check className="w-3.5 h-3.5 text-terracota mt-0.5 flex-shrink-0" />
                  <span>Cierre de caja diario X y Z con consolidación de medios de pago</span>
                </div>
                <div className="flex items-start gap-2">
                  <Check className="w-3.5 h-3.5 text-terracota mt-0.5 flex-shrink-0" />
                  <span>Envío digital directo al WhatsApp del comensal</span>
                </div>
              </div>
            </div>

            {/* Right: Thermal Receipt Artwork (Crisp White Paper, 6 cols) */}
            <div className="lg:col-span-6">
              <div className="max-w-md mx-auto bg-paper-pure text-tinta border border-paper-border p-4 sm:p-8 font-ancha text-xs shadow-sm rounded-sm relative">
                
                <div className="text-center border-b border-dashed border-paper-border pb-3 sm:pb-4 mb-3 sm:mb-4">
                  <div className="flex items-center justify-center gap-1.5 text-terracota font-bold text-[11px] sm:text-xs uppercase mb-0.5 sm:mb-1">
                    <Receipt className="w-3.5 h-3.5" />
                    <span>BLEND GASTRONOMÍA MENDOZA</span>
                  </div>
                  <div className="text-[9px] sm:text-[10px] text-tinta-muted">
                    CUIT 30-71849201-9 · Arístides Villanueva, Mendoza
                  </div>
                  <div className="mt-1.5 sm:mt-2 inline-block px-2.5 py-0.5 bg-tinta text-white text-[9px] sm:text-[10px] font-bold uppercase rounded-sm">
                    COMPROBANTE FISCAL CON CAE
                  </div>
                </div>

                <div className="space-y-1 text-[10px] sm:text-[11px] text-tinta border-b border-dashed border-paper-border pb-2.5 sm:pb-3 mb-2.5 sm:mb-3">
                  <div className="flex justify-between">
                    <span>2x MENÚ PASOS DEGUSTACIÓN</span>
                    <span>$38.000,00</span>
                  </div>
                  <div className="flex justify-between">
                    <span>1x BOTELLA MALBEC VALLE DE UCO</span>
                    <span>$16.500,00</span>
                  </div>
                  <div className="flex justify-between text-tinta font-bold pt-1 text-[11px] sm:text-xs">
                    <span>TOTAL FACTURADO:</span>
                    <span className="text-terracota font-bold">$54.500,00</span>
                  </div>
                </div>

                <div className="bg-paper-warm p-2.5 sm:p-3 border border-paper-border text-[9px] sm:text-[10px] space-y-0.5 text-tinta-muted rounded-sm">
                  <div className="flex justify-between text-tinta font-bold">
                    <span>CAE N°: 74391829304859</span>
                    <span className="text-verde font-bold">APROBADO ARCA</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Vencimiento: 31/08/2026</span>
                    <span>Pto. Vta: 0004 · Mendoza</span>
                  </div>
                </div>

              </div>
            </div>

          </div>

        </div>

      </div>
    </section>
  );
};
