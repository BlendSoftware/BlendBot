import React, { useState } from 'react';
import { sounds } from '../utils/audio';
import { Power, Check, ShieldCheck, Receipt } from 'lucide-react';

export const EditorialPillars: React.FC = () => {
  const [meatStock, setMeatStock] = useState<boolean>(true);

  const toggleStock = () => {
    const next = !meatStock;
    sounds.playSwitch(next);
    setMeatStock(next);
  };

  return (
    <section id="rituales" className="py-24 sm:py-36 bg-dark border-b border-dark-border">
      <div className="max-w-7xl mx-auto px-6 sm:px-10">
        
        {/* Section Header */}
        <div className="max-w-3xl mb-20 sm:mb-28">
          <div className="font-mono text-[10px] sm:text-xs text-terracota uppercase tracking-widest-editorial mb-3 font-bold">
            [ 02 // LA ARQUITECTURA DEL SERVICIO ]
          </div>
          <h2 className="font-serif italic font-normal text-paper-pure text-3xl sm:text-5xl lg:text-6xl leading-[1.05] tracking-tight">
            Tres rituales continuos. <br />
            <span className="font-display font-bold not-italic uppercase tracking-tightest">
              Cero gritos en el salón.
            </span>
          </h2>
          <p className="mt-4 text-base sm:text-lg text-bone-muted font-sans font-light">
            La síntesis perfecta entre hospitalidad, despacho táctil y rigor fiscal.
          </p>
        </div>

        {/* Pillars Stack (Editorial Asymmetric Magazine Spreads) */}
        <div className="space-y-28 sm:space-y-40">
          
          {/* =========================================================================
              RITUAL 01: LA CONVERSACIÓN
             ========================================================================= */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-16 items-center">
            
            {/* Left: Editorial Text (6 cols) */}
            <div className="lg:col-span-6 space-y-6">
              <div className="flex items-center gap-4">
                <span className="font-mono text-4xl sm:text-5xl font-light text-terracota">01</span>
                <div className="h-px flex-1 bg-dark-border" />
                <span className="font-mono text-[10px] uppercase tracking-widest text-bone-muted font-semibold">
                  El Anfitrión
                </span>
              </div>

              <h3 className="font-serif italic font-semibold text-2xl sm:text-4xl text-paper-pure leading-tight">
                Una conversación que comprende el apetito.
              </h3>

              <p className="text-sm sm:text-base text-bone-muted leading-relaxed font-sans font-light">
                No hay menús mecánicos con opciones numeradas ni árboles rígidos. 
                BlendBot atiende con tono rioplatense, comprende audios con ruido de fondo, 
                toma modificaciones complejas («la hamburguesa sin cebolla y las papas bien crocantes») 
                y confirma mesas según la capacidad real del salón.
              </p>

              <div className="space-y-2.5 pt-2 font-mono text-xs text-paper-pure">
                <div className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-terracota" />
                  <span>Entiende notas dietarias, puntos de cocción y alérgenos</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-terracota" />
                  <span>Calcula envíos por geolocalización en menos de 2 segundos</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-terracota" />
                  <span>Capacidad para atender 40 mesas simultáneas sin demoras</span>
                </div>
              </div>

              <blockquote className="p-4 bg-dark-surface border-l-2 border-terracota font-serif italic text-sm text-bone-muted">
                "El comensal no busca una aplicación: busca cenar bien y que lo atiendan rápido."
              </blockquote>
            </div>

            {/* Right: Editorial Dialogue Card (Crisp White Paper, 6 cols) */}
            <div className="lg:col-span-6">
              <div className="bg-paper-pure text-tinta border border-paper-border p-6 sm:p-8 shadow-2xl font-sans rounded-sm relative">
                
                <div className="flex items-center justify-between border-b border-paper-border pb-3 mb-4 font-mono text-[11px] text-tinta-muted">
                  <span className="text-tinta font-bold uppercase">Diálogo // Servicio Noche</span>
                  <span>21:14 hs</span>
                </div>

                <div className="space-y-4 text-xs sm:text-sm">
                  {/* Guest Message */}
                  <div className="pl-4 border-l-2 border-paper-border text-tinta-muted">
                    <span className="font-mono text-[10px] uppercase block mb-0.5 text-tinta-muted">Comensal</span>
                    <p className="font-serif italic text-tinta text-sm sm:text-base">
                      «Hola! Me mandás dos dobles de asado con queso ahumado? A una no le pongas cebolla por favor. Es para Thames 1840, 3° B.»
                    </p>
                  </div>

                  {/* Host Message */}
                  <div className="pl-4 border-l-2 border-terracota text-tinta bg-paper-warm p-4 rounded-sm">
                    <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase text-terracota font-bold mb-1.5">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>Respuesta en 1.4s · Comanda Marchada</span>
                    </div>
                    <p className="font-sans leading-relaxed text-xs sm:text-sm text-tinta">
                      ¡Marchando para Thames 1840, 3° B! 🍔 <br />
                      • 1x Doble Asado completa<br />
                      • 1x Doble Asado <strong className="text-terracota">SIN CEBOLLA</strong><br />
                      <span className="font-mono font-bold text-tinta block mt-1.5">Total: $24.800 (Envío bonificado)</span>
                    </p>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-paper-border flex justify-between items-center font-mono text-[10px] text-tinta-muted">
                  <span>CANAL OFICIAL WHATSAPP</span>
                  <span className="text-terracota font-bold">CERO ERRORES DE COCINA</span>
                </div>

              </div>
            </div>

          </div>


          {/* =========================================================================
              RITUAL 02: EL PULSO DEL DESPACHO & SWITCH "SE ACABÓ"
             ========================================================================= */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-16 items-center">
            
            {/* Visual Column (Order 2 on Mobile, Order 1 on Desktop) */}
            <div className="lg:col-span-6 order-2 lg:order-1">
              <div className="bg-dark-surface border border-dark-border p-6 sm:p-8 shadow-2xl rounded-sm">
                
                <div className="flex items-center justify-between border-b border-dark-border pb-3 mb-6 font-mono text-[11px] text-bone-muted">
                  <span className="text-paper-pure font-bold uppercase">Tablet de Pase // Control de Stock</span>
                  <span className="text-terracota font-bold">TOUCH ≥48PX</span>
                </div>

                {/* Interactive Stock Switch */}
                <div className="bg-dark-card border border-dark-border p-4 sm:p-5 space-y-4 rounded-sm">
                  <div>
                    <span className="font-mono text-[10px] text-bone-muted uppercase tracking-wider block">PLATO EMBLEMÁTICO</span>
                    <div className="font-serif italic font-bold text-lg sm:text-xl text-paper-pure">
                      Ojo de Bife Madurado 80 Días (600g)
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-dark-border">
                    <div className="font-mono text-xs">
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
                      className={`px-4 py-2.5 font-mono text-xs uppercase font-bold tracking-wider transition-all duration-200 active:scale-95 flex items-center gap-2 rounded-sm ${
                        meatStock 
                          ? 'border border-dark-border text-paper-pure hover:border-terracota hover:text-terracota bg-dark' 
                          : 'bg-terracota text-white shadow-lg'
                      }`}
                    >
                      <Power className="w-3.5 h-3.5" />
                      <span>{meatStock ? 'Pausar Plato' : 'SE ACABÓ'}</span>
                    </button>
                  </div>
                </div>

                <p className="mt-4 font-mono text-[11px] text-bone-muted text-center">
                  Tocá el botón para comprobar cómo conmuta el sistema en tiempo real.
                </p>

              </div>
            </div>

            {/* Text Column (Order 1 on Mobile, Order 2 on Desktop) */}
            <div className="lg:col-span-6 order-1 lg:order-2 space-y-6">
              <div className="flex items-center gap-4">
                <span className="font-mono text-4xl sm:text-5xl font-light text-terracota">02</span>
                <div className="h-px flex-1 bg-dark-border" />
                <span className="font-mono text-[10px] uppercase tracking-widest text-bone-muted font-semibold">
                  El Pase de Cocina
                </span>
              </div>

              <h3 className="font-serif italic font-semibold text-2xl sm:text-4xl text-paper-pure leading-tight">
                El interruptor sagrado: saber qué hay de verdad.
              </h3>

              <p className="text-sm sm:text-base text-bone-muted leading-relaxed font-sans font-light">
                En el fragor de la cocina, si se termina el último corte, nadie tiene tiempo de editar una página web. 
                En la tablet del mostrador, un solo toque en "SE ACABÓ" apaga el plato en WhatsApp al instante. 
                El bot deja de ofrecerlo y sugiere una alternativa noble sin que se caiga la venta.
              </p>

              <div className="space-y-2.5 pt-2 font-mono text-xs text-paper-pure">
                <div className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-terracota" />
                  <span>Diseñado para operarse con el pulgar con grasa o harina</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-terracota" />
                  <span>Estados cromáticos visibles a dos metros de distancia con reflejos</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-terracota" />
                  <span>Ajuste de demora global con un solo toque (+15 min)</span>
                </div>
              </div>
            </div>

          </div>


          {/* =========================================================================
              RITUAL 03: EL ACTO FISCAL
             ========================================================================= */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-16 items-center">
            
            {/* Left: Text Column (6 cols) */}
            <div className="lg:col-span-6 space-y-6">
              <div className="flex items-center gap-4">
                <span className="font-mono text-4xl sm:text-5xl font-light text-terracota">03</span>
                <div className="h-px flex-1 bg-dark-border" />
                <span className="font-mono text-[10px] uppercase tracking-widest text-bone-muted font-semibold">
                  El Cierre Impecable
                </span>
              </div>

              <h3 className="font-serif italic font-semibold text-2xl sm:text-4xl text-paper-pure leading-tight">
                Cobrás la mesa y el comprobante de ARCA sale solo.
              </h3>

              <p className="text-sm sm:text-base text-bone-muted leading-relaxed font-sans font-light">
                Desde julio de 2026 la factura electrónica es obligatoria para todo el sector gastronómico en Argentina. 
                BlendBot se integra de forma directa con el servicio oficial de ARCA: 
                al tocar "Cobrar", se emite la Factura con CAE homologado y código QR en menos de 1 segundo.
              </p>

              <div className="space-y-2.5 pt-2 font-mono text-xs text-paper-pure">
                <div className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-terracota" />
                  <span>Cumplimiento tributario automático según normativa 2026</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-terracota" />
                  <span>Cero planillas manuales a la madrugada después del cierre</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-terracota" />
                  <span>Envío opcional del ticket digital al WhatsApp del comensal</span>
                </div>
              </div>
            </div>

            {/* Right: Thermal Receipt Artwork (Crisp White Paper, 6 cols) */}
            <div className="lg:col-span-6">
              <div className="max-w-md mx-auto bg-paper-pure text-tinta border border-paper-border p-6 sm:p-8 font-mono text-xs shadow-2xl rounded-sm relative">
                
                <div className="text-center border-b border-dashed border-paper-border pb-4 mb-4">
                  <div className="flex items-center justify-center gap-1.5 text-terracota font-bold text-xs uppercase mb-1">
                    <Receipt className="w-3.5 h-3.5" />
                    <span>BLEND GASTRONOMÍA S.R.L.</span>
                  </div>
                  <div className="text-[10px] text-tinta-muted">
                    CUIT 30-71849201-9 · CABA
                  </div>
                  <div className="mt-2 inline-block px-2.5 py-0.5 bg-dark text-white text-[10px] font-bold uppercase rounded-sm">
                    COMPROBANTE FISCAL CON CAE
                  </div>
                </div>

                <div className="space-y-1.5 text-[11px] text-tinta border-b border-dashed border-paper-border pb-3 mb-3">
                  <div className="flex justify-between">
                    <span>2x DOBLE ASADO MADURADO</span>
                    <span>$19.600,00</span>
                  </div>
                  <div className="flex justify-between">
                    <span>1x PAPAS TRUFADAS</span>
                    <span>$5.800,00</span>
                  </div>
                  <div className="flex justify-between text-tinta font-bold pt-1 text-xs">
                    <span>TOTAL FACTURADO:</span>
                    <span className="text-terracota font-bold">$25.400,00</span>
                  </div>
                </div>

                <div className="bg-paper-warm p-3 border border-paper-border text-[10px] space-y-0.5 text-tinta-muted rounded-sm">
                  <div className="flex justify-between text-tinta font-bold">
                    <span>CAE N°: 74391829304859</span>
                    <span className="text-verde font-bold">APROBADO ARCA</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Vencimiento: 31/08/2026</span>
                    <span>Pto. Vta: 0004</span>
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
