import React, { useState } from 'react';
import { MessageSquare, Tablet, Receipt, BarChart3, Wrench, ShieldCheck, Power, ArrowUpRight, Check } from 'lucide-react';

interface FullSystemEquipProps {
  onOpenDemo: () => void;
}

export const FullSystemEquip: React.FC<FullSystemEquipProps> = ({ onOpenDemo }) => {
  const [kitchenStock, setKitchenStock] = useState<boolean>(true);

  const toggleKitchenStock = () => {
    const next = !kitchenStock;
    setKitchenStock(next);
  };

  return (
    <section id="equipamiento" className="py-16 sm:py-36 bg-dark-surface border-b border-dark-border relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-8 lg:px-10">
        
        {/* Section Masthead */}
        <div className="max-w-3xl mb-12 sm:mb-24">
          <div className="font-mono text-[9px] sm:text-xs text-terracota uppercase tracking-widest-editorial mb-2 sm:mb-3 font-bold flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-terracota" />
            <span>[ 03 // EL EQUIPAMIENTO COMPLETO ]</span>
          </div>
          <h2 className="font-serif font-semibold text-tinta text-2xl xs:text-3xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-tight">
            Cinco estaciones conectadas. <br />
            <span className="font-display font-bold uppercase tracking-tightest">
              Un solo cerebro operativo.
            </span>
          </h2>
          <p className="mt-3 sm:mt-4 text-sm sm:text-lg text-bone-muted font-sans font-normal leading-relaxed">
            Eliminamos los sistemas desconectados: tu WhatsApp, tu cocina, tu salón y tu facturación fiscal funcionan como un único engranaje en Mendoza.
          </p>
        </div>

        {/* Asymmetric Station Dossier Layout */}
        <div className="space-y-6 sm:space-y-8">
          
          {/* =========================================================================
              ROW 1: ESTACIÓN 01 (HERO CARD) -> WHATSAPP & SALÓN
             ========================================================================= */}
          <div className="bg-paper-pure text-tinta border border-paper-border p-5 sm:p-8 lg:p-12 rounded-sm shadow-sm relative overflow-hidden">
            
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8 lg:gap-12 items-center">
              
              {/* Left Column (7 cols) */}
              <div className="lg:col-span-7 space-y-4 sm:space-y-6">
                
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-sm bg-paper-warm border border-paper-border flex items-center justify-center text-terracota flex-shrink-0">
                    <MessageSquare className="w-4 h-4 sm:w-5 sm:h-5" />
                  </div>
                  <div>
                    <span className="font-mono text-[9px] sm:text-[10px] uppercase tracking-widest text-terracota font-bold block">
                      ESTACIÓN 01 // FRONT-OF-HOUSE
                    </span>
                    <h3 className="font-serif font-bold text-xl sm:text-3xl text-tinta leading-snug">
                      Recepción, Reservas & Delivery por WhatsApp
                    </h3>
                  </div>
                </div>

                <p className="text-xs sm:text-base text-tinta-muted font-sans font-normal leading-relaxed">
                  El anfitrión que atiende a tus clientes 24/7 en el número oficial de tu local.
                  Comprende audios, modismos mendocinos, gestiona reservas de mesas o degustaciones según los turnos de tu salón y toma los pedidos completos.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3 pt-1 sm:pt-2 font-sans text-xs text-tinta">
                  <div className="flex items-start gap-2">
                    <Check className="w-3.5 h-3.5 text-terracota mt-0.5 flex-shrink-0" />
                    <span>Reservas automáticas con límite de aforo por turno</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Check className="w-3.5 h-3.5 text-terracota mt-0.5 flex-shrink-0" />
                    <span>Responde consultas de cartas de vino y alérgenos</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Check className="w-3.5 h-3.5 text-terracota mt-0.5 flex-shrink-0" />
                    <span>Cálculo exacto de envío en Gran Mendoza y bodegas</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Check className="w-3.5 h-3.5 text-terracota mt-0.5 flex-shrink-0" />
                    <span>Intervención manual en cualquier chat con un clic</span>
                  </div>
                </div>

              </div>

              {/* Right Column: Live Chat Simulation Plate (5 cols) */}
              <div className="lg:col-span-5 bg-paper-warm border border-paper-border p-4 sm:p-6 rounded-sm space-y-3 sm:space-y-4 text-xs font-sans shadow-inner">
                <div className="flex items-center justify-between border-b border-paper-border pb-2.5 sm:pb-3 font-mono text-[9px] sm:text-[10px] text-tinta-muted">
                  <span className="font-bold uppercase text-tinta">CHAT EN VIVO // LÍNEA OFICIAL</span>
                  <span className="text-verde font-bold">● ONLINE</span>
                </div>

                <div className="space-y-2.5 sm:space-y-3">
                  <div className="pl-3 border-l-2 border-paper-border text-tinta-muted">
                    <span className="font-mono text-[8px] sm:text-[9px] uppercase block text-tinta-muted/80">Comensal · 20:45 hs</span>
                    <p className="font-serif text-tinta text-xs">
                      «Hola! Tienen lugar para 6 personas hoy tipo 21:30? Quisiéramos hacer la degustación de pasos.»
                    </p>
                  </div>

                  <div className="pl-3 border-l-2 border-terracota bg-paper-pure p-2.5 sm:p-3 rounded-sm text-tinta shadow-sm">
                    <div className="flex items-center gap-1.5 font-mono text-[8px] sm:text-[9px] text-terracota font-bold mb-1">
                      <ShieldCheck className="w-3 h-3" />
                      <span>Respuesta en 1.1s</span>
                    </div>
                    <p className="leading-relaxed text-xs">
                      ¡Buenas noches! Sí, tenemos la <strong className="text-terracota">Mesa 8</strong> lista en la galería para 6 personas a las 21:30 hs. 🍷<br />
                      ¿Te la confirmo a tu nombre?
                    </p>
                  </div>
                </div>

                <div className="pt-2 border-t border-paper-border flex justify-between items-center font-mono text-[8px] sm:text-[9px] text-tinta-muted">
                  <span>CANAL EXCLUSIVO DE TU LOCAL</span>
                  <span className="text-terracota font-bold">0% COMISIÓN</span>
                </div>
              </div>

            </div>

          </div>


          {/* =========================================================================
              ROW 2: TWO COLUMNS (ESTACIÓN 02 & ESTACIÓN 03)
             ========================================================================= */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8">
            
            {/* Card 2: Cocina Táctil & Switch SE ACABÓ */}
            <div className="bg-dark-card border border-dark-border p-5 sm:p-8 rounded-sm shadow-sm flex flex-col justify-between space-y-4 sm:space-y-6">
              
              <div className="space-y-3 sm:space-y-4">
                <div className="flex items-center justify-between border-b border-dark-border pb-3 sm:pb-4">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-sm bg-dark-surface border border-dark-border flex items-center justify-center text-terracota flex-shrink-0">
                      <Tablet className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    </div>
                    <div>
                      <span className="font-mono text-[8px] sm:text-[9px] uppercase tracking-widest text-terracota font-bold block">
                        ESTACIÓN 02 // COCINA & BARRA
                      </span>
                      <h4 className="font-serif font-bold text-lg sm:text-xl text-tinta">
                        Comandera Táctil & Switch de Stock
                      </h4>
                    </div>
                  </div>
                  <span className="font-mono text-xs font-bold text-bone-muted">02</span>
                </div>

                <p className="text-xs sm:text-sm text-bone-muted font-sans font-normal leading-relaxed">
                  Pantalla táctil de alto contraste para cocineros. Si se termina el último corte, un toque en <strong>"SE ACABÓ"</strong> pausa el ítem en WhatsApp al instante para no vender de más.
                </p>

                {/* Interactive Switch Demo */}
                <div className="bg-dark-surface border border-dark-border p-3.5 sm:p-4 rounded-sm space-y-2.5 sm:space-y-3">
                  <div className="flex justify-between items-center font-mono text-[9px] sm:text-[10px] text-bone-muted">
                    <span>PLATO EN DESPACHO:</span>
                    <span className={kitchenStock ? 'text-verde font-bold' : 'text-terracota font-bold'}>
                      {kitchenStock ? '● ACTIVO EN CARTA' : '● PAUSADO EN WHATSAPP'}
                    </span>
                  </div>
                  <div className="font-serif font-bold text-sm sm:text-base text-tinta">
                    Ojo de Bife a la Brasa (600g)
                  </div>
                  <button
                    onClick={toggleKitchenStock}
                    className={`w-full py-2.5 sm:py-3 font-mono text-xs uppercase font-bold tracking-wider transition-all duration-200 active:scale-95 flex items-center justify-center gap-2 rounded-sm min-h-[44px] ${
                      kitchenStock 
                        ? 'border border-dark-border text-tinta hover:border-terracota hover:text-terracota bg-dark' 
                        : 'bg-terracota text-white shadow-lg'
                    }`}
                  >
                    <Power className="w-3.5 h-3.5" />
                    <span>{kitchenStock ? 'Pausar Plato (SE ACABÓ)' : 'Reanudar Disponibilidad'}</span>
                  </button>
                </div>
              </div>

              <div className="pt-2.5 sm:pt-3 border-t border-dark-border font-mono text-[9px] sm:text-[10px] text-bone-muted flex justify-between">
                <span>TOUCHSCREEN ≥48PX</span>
                <span className="text-terracota font-bold">TIEMPO REAL</span>
              </div>

            </div>

            {/* Card 3: Facturación Fiscal ARCA */}
            <div className="bg-dark-card border border-dark-border p-5 sm:p-8 rounded-sm shadow-sm flex flex-col justify-between space-y-4 sm:space-y-6">
              
              <div className="space-y-3 sm:space-y-4">
                <div className="flex items-center justify-between border-b border-dark-border pb-3 sm:pb-4">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-sm bg-dark-surface border border-dark-border flex items-center justify-center text-terracota flex-shrink-0">
                      <Receipt className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    </div>
                    <div>
                      <span className="font-mono text-[8px] sm:text-[9px] uppercase tracking-widest text-terracota font-bold block">
                        ESTACIÓN 03 // FACTURACIÓN FISCAL
                      </span>
                      <h4 className="font-serif font-bold text-lg sm:text-xl text-tinta">
                        Emisión Automática ARCA (AFIP)
                      </h4>
                    </div>
                  </div>
                  <span className="font-mono text-xs font-bold text-bone-muted">03</span>
                </div>

                <p className="text-xs sm:text-sm text-bone-muted font-sans font-normal leading-relaxed">
                  Conectado al web service oficial de ARCA. Al cobrar la cuenta, se emite la Factura A, B o C con CAE homologado y código QR en menos de 1 segundo sin tocar la web de AFIP.
                </p>

                {/* Thermal Ticket Preview */}
                <div className="bg-paper-pure text-tinta border border-paper-border p-3.5 sm:p-4 rounded-sm font-mono text-[9px] sm:text-[10px] space-y-1 sm:space-y-1.5 shadow-md">
                  <div className="flex justify-between font-bold border-b border-dashed border-paper-border pb-1.5 text-terracota">
                    <span>FACTURA B #0004-001948</span>
                    <span>CAE APROBADO</span>
                  </div>
                  <div className="flex justify-between text-tinta-muted">
                    <span>Mesa 4 · 2x Menú Degustación</span>
                    <span>$38.000,00</span>
                  </div>
                  <div className="flex justify-between text-tinta font-bold pt-1 border-t border-dashed border-paper-border">
                    <span>TOTAL FISCAL:</span>
                    <span>$38.000,00</span>
                  </div>
                </div>
              </div>

              <div className="pt-2.5 sm:pt-3 border-t border-dark-border font-mono text-[9px] sm:text-[10px] text-bone-muted flex justify-between">
                <span>NORMATIVA 2026 ARCA</span>
                <span className="text-verde font-bold">100% HOMOLOGADO</span>
              </div>

            </div>

          </div>


          {/* =========================================================================
              ROW 3: TWO COLUMNS (ESTACIÓN 04 & ESTACIÓN 05)
             ========================================================================= */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8">
            
            {/* Card 4: Cierre de Caja & Demanda Insatisfecha */}
            <div className="bg-dark-card border border-dark-border p-5 sm:p-8 rounded-sm shadow-sm flex flex-col justify-between space-y-4 sm:space-y-6">
              
              <div className="space-y-3 sm:space-y-4">
                <div className="flex items-center justify-between border-b border-dark-border pb-3 sm:pb-4">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-sm bg-dark-surface border border-dark-border flex items-center justify-center text-terracota flex-shrink-0">
                      <BarChart3 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    </div>
                    <div>
                      <span className="font-mono text-[8px] sm:text-[9px] uppercase tracking-widest text-terracota font-bold block">
                        ESTACIÓN 04 // EL DESPACHO DEL DUEÑO
                      </span>
                      <h4 className="font-serif font-bold text-lg sm:text-xl text-tinta">
                        Cierre X/Z & Demanda Insatisfecha
                      </h4>
                    </div>
                  </div>
                  <span className="font-mono text-xs font-bold text-bone-muted">04</span>
                </div>

                <p className="text-xs sm:text-sm text-bone-muted font-sans font-normal leading-relaxed">
                  Arqueo diario claro de efectivo, transferencias, QR y tarjetas. Y el reporte más valioso: cuánta plata dejaste sobre la mesa por platos que te pidieron y no tenías en stock.
                </p>

                <div className="space-y-1.5 sm:space-y-2 text-xs font-sans text-bone-muted pt-1">
                  <div className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-terracota flex-shrink-0" />
                    <span>Consolidado automático para el contador</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-terracota flex-shrink-0" />
                    <span>Control de ventas por turno (almuerzo vs. noche)</span>
                  </div>
                </div>
              </div>

              <div className="pt-2.5 sm:pt-3 border-t border-dark-border font-mono text-[9px] sm:text-[10px] text-bone-muted flex justify-between">
                <span>VISTA PRIVADA DEL DUEÑO</span>
                <span className="text-terracota font-bold">CONTROL TOTAL</span>
              </div>

            </div>

            {/* Card 5: Puesta en Marcha Llave en Mano en Mendoza */}
            <div className="bg-paper-pure text-tinta border border-paper-border p-5 sm:p-8 rounded-sm shadow-sm flex flex-col justify-between space-y-4 sm:space-y-6">
              
              <div className="space-y-3 sm:space-y-4">
                <div className="flex items-center justify-between border-b border-paper-border pb-3 sm:pb-4">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-sm bg-paper-warm border border-paper-border flex items-center justify-center text-terracota flex-shrink-0">
                      <Wrench className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    </div>
                    <div>
                      <span className="font-mono text-[8px] sm:text-[9px] uppercase tracking-widest text-terracota font-bold block">
                        ESTACIÓN 05 // INSTALACIÓN & SOPORTE
                      </span>
                      <h4 className="font-serif font-bold text-lg sm:text-xl text-tinta">
                        Puesta en Marcha en 48hs en Mendoza
                      </h4>
                    </div>
                  </div>
                  <span className="font-mono text-xs font-bold text-tinta-muted">05</span>
                </div>

                <p className="text-xs sm:text-sm text-tinta-muted font-sans font-normal leading-relaxed">
                  Configuramos tu WhatsApp oficial, conectamos tu certificado de ARCA y dejamos todo el restaurante operando.
                </p>

                <div className="space-y-1.5 sm:space-y-2 text-xs font-sans text-tinta pt-1">
                  <div className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-terracota flex-shrink-0" />
                    <span>Capacitación simple al equipo en 5 minutos</span>
                  </div>
                </div>
              </div>

              <div className="pt-2.5 sm:pt-3 border-t border-paper-border font-mono text-[9px] sm:text-[10px] text-tinta-muted flex justify-between">
                <span>GRAN MENDOZA & VALLE DE UCO</span>
                <span className="text-verde font-bold">LISTO EN 48HS</span>
              </div>

            </div>

          </div>

        </div>

        {/* Bottom Banner Call to Action (Full width on mobile) */}
        <div className="mt-12 sm:mt-16 p-6 sm:p-10 bg-dark-card border border-dark-border rounded-sm flex flex-col md:flex-row items-center justify-between gap-5 sm:gap-6 shadow-sm">
          <div className="space-y-1.5 sm:space-y-2 text-center md:text-left">
            <span className="font-mono text-[9px] sm:text-[10px] uppercase tracking-widest text-terracota font-bold block">
              INSTALACIÓN EN GRAN MENDOZA & VALLE DE UCO
            </span>
            <h3 className="font-serif font-bold text-xl sm:text-3xl text-tinta">
              ¿Querés equipar tu restaurante o bodega?
            </h3>
            <p className="text-xs sm:text-sm text-bone-muted max-w-xl font-normal">
              Coordinamos una demostración personalizada con la carta real y el esquema de mesas de tu local.
            </p>
          </div>

          <button
            onClick={() => {
              onOpenDemo();
            }}
            className="w-full md:w-auto px-6 py-4 bg-terracota hover:bg-terracota-light text-white font-mono text-xs uppercase font-bold tracking-wider rounded-sm transition-all duration-200 active:scale-95 shadow-sm flex items-center justify-center gap-2 flex-shrink-0 min-h-[48px]"
          >
            <span>Solicitar Demostración en Mendoza</span>
            <ArrowUpRight className="w-4 h-4" />
          </button>
        </div>

      </div>
    </section>
  );
};
