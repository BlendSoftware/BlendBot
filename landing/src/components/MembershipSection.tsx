import React from 'react';
import { Check, ArrowUpRight } from 'lucide-react';
import { sounds } from '../utils/audio';

interface MembershipSectionProps {
  onOpenDemo: () => void;
}

export const MembershipSection: React.FC<MembershipSectionProps> = ({ onOpenDemo }) => {
  return (
    <section id="acceso" className="py-24 sm:py-36 bg-dark-surface border-b border-dark-border relative">
      <div className="max-w-5xl mx-auto px-6 sm:px-10">
        
        {/* Section Header */}
        <div className="text-center max-w-2xl mx-auto mb-16">
          <div className="font-mono text-[10px] sm:text-xs text-terracota uppercase tracking-widest-editorial mb-3 font-bold">
            [ 05 // LA MEMBRESÍA ]
          </div>
          <h2 className="font-serif italic font-normal text-paper-pure text-3xl sm:text-5xl font-bold tracking-tight">
            Un abono plano y honesto. <br />
            <span className="font-display font-bold not-italic uppercase tracking-tightest">
              Cero comisiones sobre tus ventas.
            </span>
          </h2>
          <p className="mt-4 text-sm sm:text-base text-bone-muted font-sans font-light">
            Tu facturación es 100% tuya. Sin porcentajes del 30% ni cargos ocultos por comanda.
          </p>
        </div>

        {/* Membership Crisp White Paper Box */}
        <div className="bg-paper-pure text-tinta border border-paper-border p-8 sm:p-12 shadow-2xl rounded-sm relative">
          
          <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-6 border-b border-paper-border pb-8 mb-8">
            <div>
              <span className="font-mono text-[10px] text-terracota uppercase tracking-widest font-bold block mb-1">
                PLAN ANFITRIÓN INTEGRAL
              </span>
              <h3 className="font-serif italic font-bold text-2xl sm:text-3xl text-tinta">
                Copiloto Gastronómico Blend
              </h3>
              <p className="text-xs text-tinta-muted font-sans mt-1">
                Para locales que cuidan la experiencia, el stock y la mesa.
              </p>
            </div>

            <div className="text-left sm:text-right">
              <div className="flex items-baseline gap-1">
                <span className="font-serif italic font-bold text-4xl sm:text-5xl text-tinta">
                  $79.000
                </span>
                <span className="font-mono text-xs text-tinta-muted uppercase">
                  ARS / mes
                </span>
              </div>
              <span className="font-mono text-[10px] text-terracota font-bold uppercase block mt-1">
                0% Comisión x Comanda · + IVA
              </span>
            </div>
          </div>

          {/* Deliverables */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 font-sans text-xs sm:text-sm text-tinta mb-8">
            <div className="flex items-start gap-3">
              <div className="w-4 h-4 rounded-full bg-paper-warm border border-paper-border flex items-center justify-center text-terracota flex-shrink-0 mt-0.5">
                <Check className="w-2.5 h-2.5" />
              </div>
              <span><strong className="font-bold">WhatsApp Oficial 24/7</strong> (atiende pedidos, audios y reservas)</span>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-4 h-4 rounded-full bg-paper-warm border border-paper-border flex items-center justify-center text-terracota flex-shrink-0 mt-0.5">
                <Check className="w-2.5 h-2.5" />
              </div>
              <span><strong className="font-bold">Panel de Despacho Táctil Ilimitado</strong> para cocina y barra</span>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-4 h-4 rounded-full bg-paper-warm border border-paper-border flex items-center justify-center text-terracota flex-shrink-0 mt-0.5">
                <Check className="w-2.5 h-2.5" />
              </div>
              <span><strong className="font-bold">Switch "SE ACABÓ"</strong> (pausado instantáneo de platos)</span>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-4 h-4 rounded-full bg-paper-warm border border-paper-border flex items-center justify-center text-terracota flex-shrink-0 mt-0.5">
                <Check className="w-2.5 h-2.5" />
              </div>
              <span><strong className="font-bold">Facturación Fiscal ARCA Homologada</strong> (comprobantes con CAE)</span>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-4 h-4 rounded-full bg-paper-warm border border-paper-border flex items-center justify-center text-terracota flex-shrink-0 mt-0.5">
                <Check className="w-2.5 h-2.5" />
              </div>
              <span><strong className="font-bold">Puesta en marcha en 48hs</strong> con carga de tu carta</span>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-4 h-4 rounded-full bg-paper-warm border border-paper-border flex items-center justify-center text-terracota flex-shrink-0 mt-0.5">
                <Check className="w-2.5 h-2.5" />
              </div>
              <span><strong className="font-bold">Prueba piloto de 2 meses</strong> para locales seleccionados</span>
            </div>
          </div>

          {/* Action */}
          <div className="pt-2">
            <button
              onClick={() => {
                sounds.playKitchenBell();
                onOpenDemo();
              }}
              className="w-full py-4 bg-terracota hover:bg-terracota-light text-white font-mono text-xs uppercase font-bold tracking-wider flex items-center justify-center gap-2 rounded-sm transition-all active:scale-98 shadow-xl"
            >
              <span>Solicitar Prueba Piloto de 2 Meses</span>
              <ArrowUpRight className="w-4 h-4" />
            </button>
            <div className="font-mono text-[10px] text-tinta-muted text-center mt-2">
              Sin permanencia mínima · Cancelás con un clic
            </div>
          </div>

        </div>

      </div>
    </section>
  );
};
