import React from 'react';
import { Check, ArrowUpRight } from 'lucide-react';

interface MembershipSectionProps {
  onOpenDemo: () => void;
}

export const MembershipSection: React.FC<MembershipSectionProps> = ({ onOpenDemo }) => {
  return (
    <section id="acceso" className="py-16 sm:py-36 bg-dark-surface border-b border-dark-border relative">
      <div className="max-w-5xl mx-auto px-4 sm:px-8 lg:px-10">
        
        {/* Section Header */}
        <div className="text-center max-w-2xl mx-auto mb-10 sm:mb-16">
          <div className="font-ancha text-[9px] sm:text-xs text-terracota uppercase tracking-widest-editorial mb-2 sm:mb-3 font-bold flex items-center justify-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-terracota" />
            <span>[ 05 // LA PROPUESTA ]</span>
          </div>
          <h2 className="font-serif font-semibold text-tinta text-2xl xs:text-3xl sm:text-5xl font-bold tracking-tight">
            Un abono plano y honesto. <br />
            <span className="font-display font-bold uppercase tracking-tightest">
              Cero comisiones sobre tus ventas.
            </span>
          </h2>
          <p className="mt-3 sm:mt-4 text-xs sm:text-base text-bone-muted font-sans font-normal">
            Tu facturación es 100% tuya. Sin porcentajes del 30% ni comisiones por reserva o comanda.
          </p>
        </div>

        {/* Membership Crisp White Paper Box */}
        <div className="bg-paper-pure text-tinta border border-paper-border p-5 sm:p-8 lg:p-12 shadow-sm rounded-sm relative">
          
          <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-4 sm:gap-6 border-b border-paper-border pb-6 sm:pb-8 mb-6 sm:mb-8">
            <div>
              <span className="font-ancha text-[9px] sm:text-[10px] text-terracota uppercase tracking-widest font-bold block mb-1">
                EQUIPAMIENTO COMPLETO // MENDOZA
              </span>
              <h3 className="font-serif font-bold text-xl sm:text-3xl text-tinta">
                Copiloto Gastronómico Blend
              </h3>
              <p className="text-xs text-tinta-muted font-sans mt-0.5 sm:mt-1">
                Para restaurantes, bodegas, bistrós, pizzerías y hamburgueserías.
              </p>
            </div>

            <div className="text-left sm:text-right pt-2 sm:pt-0">
              <div className="flex items-baseline gap-1.5">
                <span className="font-serif font-bold text-3xl sm:text-5xl text-tinta">
                  $79.000
                </span>
                <span className="font-ancha text-xs text-tinta-muted uppercase">
                  ARS / mes
                </span>
              </div>
              <span className="font-ancha text-[9px] sm:text-[10px] text-terracota font-bold uppercase block mt-0.5 sm:mt-1">
                0% Comisión x Comanda · + IVA
              </span>
            </div>
          </div>

          {/* Deliverables */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 font-sans text-xs sm:text-sm text-tinta mb-6 sm:mb-8">
            <div className="flex items-start gap-2.5 sm:gap-3">
              <div className="w-4 h-4 rounded-full bg-paper-warm border border-paper-border flex items-center justify-center text-terracota flex-shrink-0 mt-0.5">
                <Check className="w-2.5 h-2.5" />
              </div>
              <span><strong className="font-bold">WhatsApp Oficial 24/7</strong> (reservas de mesa/degustación y pedidos)</span>
            </div>

            <div className="flex items-start gap-2.5 sm:gap-3">
              <div className="w-4 h-4 rounded-full bg-paper-warm border border-paper-border flex items-center justify-center text-terracota flex-shrink-0 mt-0.5">
                <Check className="w-2.5 h-2.5" />
              </div>
              <span><strong className="font-bold">Comandera Táctil Ilimitada</strong> para cocina, barra y salón</span>
            </div>

            <div className="flex items-start gap-2.5 sm:gap-3">
              <div className="w-4 h-4 rounded-full bg-paper-warm border border-paper-border flex items-center justify-center text-terracota flex-shrink-0 mt-0.5">
                <Check className="w-2.5 h-2.5" />
              </div>
              <span><strong className="font-bold">Switch "SE ACABÓ"</strong> (control de disponibilidad de platos en vivo)</span>
            </div>

            <div className="flex items-start gap-2.5 sm:gap-3">
              <div className="w-4 h-4 rounded-full bg-paper-warm border border-paper-border flex items-center justify-center text-terracota flex-shrink-0 mt-0.5">
                <Check className="w-2.5 h-2.5" />
              </div>
              <span><strong className="font-bold">Facturación Fiscal ARCA Homologada</strong> (comprobantes con CAE)</span>
            </div>

            <div className="flex items-start gap-2.5 sm:gap-3">
              <div className="w-4 h-4 rounded-full bg-paper-warm border border-paper-border flex items-center justify-center text-terracota flex-shrink-0 mt-0.5">
                <Check className="w-2.5 h-2.5" />
              </div>
              <span><strong className="font-bold">Cierre de Caja X/Z</strong> y análisis de demanda insatisfecha</span>
            </div>

            <div className="flex items-start gap-2.5 sm:gap-3">
              <div className="w-4 h-4 rounded-full bg-paper-warm border border-paper-border flex items-center justify-center text-terracota flex-shrink-0 mt-0.5">
                <Check className="w-2.5 h-2.5" />
              </div>
              <span><strong className="font-bold">Puesta en marcha en 48hs</strong> con carga de tu carta en Mendoza</span>
            </div>
          </div>

          {/* Action */}
          <div className="pt-1 sm:pt-2">
            <button
              onClick={() => {
                onOpenDemo();
              }}
              className="w-full py-4 bg-terracota hover:bg-terracota-light text-white font-ancha text-xs uppercase font-bold tracking-wider flex items-center justify-center gap-2 rounded-sm transition-all active:scale-98 shadow-sm min-h-[48px]"
            >
              <span>Solicitar Prueba Piloto de 2 Meses</span>
              <ArrowUpRight className="w-4 h-4" />
            </button>
            <div className="font-ancha text-[9px] sm:text-[10px] text-tinta-muted text-center mt-2">
              Sin permanencia mínima · Cancelás con un clic
            </div>
          </div>

        </div>

      </div>
    </section>
  );
};
