import React from 'react';
import { ArrowDownRight } from 'lucide-react';
import { sounds } from '../utils/audio';

interface HeroProps {
  onOpenSimulator: () => void;
  onOpenDemo: () => void;
}

export const Hero: React.FC<HeroProps> = ({ onOpenSimulator, onOpenDemo }) => {
  return (
    <section id="hero" className="relative min-h-[92vh] pt-28 sm:pt-36 pb-16 sm:pb-24 flex flex-col justify-between border-b border-dark-border bg-dark">
      
      <div className="max-w-7xl mx-auto px-6 sm:px-10 w-full">
        
        {/* Top Editorial Index Bar */}
        <div className="flex items-center justify-between border-b border-dark-border pb-4 mb-8 sm:mb-12 font-mono text-[11px] text-bone-muted uppercase tracking-widest">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-terracota" />
            <span className="text-paper-pure font-semibold">HOSPITALIDAD & DESPACHO // 2026</span>
          </div>
          <div className="hidden sm:block text-bone-muted">
            WHATSAPP CONVERSACIONAL · COCINA TÁCTIL · FACTURA ARCA
          </div>
          <div className="text-terracota font-bold">
            BUENOS AIRES
          </div>
        </div>

        {/* Monumental Asymmetric Editorial Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-end">
          
          {/* Left Column: Big Typographic Statement (7 cols) */}
          <div className="lg:col-span-7 space-y-6 sm:space-y-8">
            
            <div className="font-mono text-[10px] sm:text-xs text-terracota uppercase tracking-widest-editorial font-bold">
              [ EL SERVICIO SILENCIOSO ]
            </div>

            <h1 className="font-serif italic font-normal text-paper-pure text-[2.8rem] sm:text-[4.5rem] md:text-[5.5rem] lg:text-[6.2rem] leading-[0.9] tracking-tight">
              Cuando el fuego habla, <br />
              <span className="font-display font-black not-italic text-paper-pure uppercase tracking-tightest block mt-1">
                el resto es silencio.
              </span>
            </h1>

            <p className="text-base sm:text-lg text-bone-muted max-w-xl font-sans font-light leading-relaxed">
              El sistema que atiende las mesas por WhatsApp con calidez humana, 
              organiza la cocina al segundo con el switch de disponibilidad y <strong className="text-paper-pure font-normal underline decoration-terracota decoration-2 underline-offset-4">emite la factura de ARCA</strong> al cobrar.
            </p>

            {/* Editorial Action Line */}
            <div className="pt-2 flex flex-wrap items-center gap-4 font-mono text-xs">
              <button
                onClick={() => {
                  sounds.playClick();
                  onOpenDemo();
                }}
                className="px-6 py-3.5 bg-paper-pure text-tinta hover:bg-terracota hover:text-white font-bold uppercase tracking-wider rounded-sm transition-all duration-200 active:scale-95 shadow-xl"
              >
                Sumar mi Local
              </button>

              <button
                onClick={() => {
                  sounds.playKitchenBell();
                  onOpenSimulator();
                }}
                className="inline-flex items-center gap-2 px-5 py-3.5 border border-dark-border hover:border-terracota text-paper-pure hover:text-terracota rounded-sm transition-colors active:scale-95 bg-dark-surface/40"
              >
                <span>Ver los 3 Rituales</span>
                <ArrowDownRight className="w-4 h-4 text-terracota" />
              </button>
            </div>

          </div>

          {/* Right Column: Hero Moody Food Artwork (5 cols) */}
          <div className="lg:col-span-5 relative">
            
            <div className="relative overflow-hidden bg-dark-surface border border-dark-border rounded-sm shadow-2xl">
              
              {/* Main Cut Image */}
              <img 
                src="https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=1200&q=85" 
                alt="Corte madurado a las brasas en cocina" 
                className="w-full h-[380px] sm:h-[460px] object-cover object-center filter saturate-[0.9] contrast-[1.1] hover:scale-105 transition-transform duration-1000"
                fetchPriority="high"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-dark/90 via-transparent to-transparent" />

              {/* Offset Crisp White Paper Caption Overlay */}
              <div className="p-4 sm:p-5 bg-paper-pure text-tinta border-t border-paper-border font-mono text-[10px] flex items-center justify-between shadow-md">
                <div>
                  <span className="font-bold block uppercase tracking-wider text-tinta">MATERIA PRIMA PURA</span>
                  <span className="text-tinta-muted">Cocina directa a 850°C · Cero intermediarios</span>
                </div>
                <div className="text-right">
                  <span className="text-terracota font-bold text-xs">0% COMISIÓN</span>
                </div>
              </div>

            </div>

            {/* Overlapping Paper Stamp */}
            <div className="absolute -top-3 -left-3 sm:-left-5 bg-paper-pure text-tinta border border-terracota/60 px-3 py-1.5 shadow-lg transform -rotate-2 font-mono text-[10px] uppercase tracking-wider font-bold">
              <span className="text-terracota">●</span> PILOTO 2 MESES
            </div>

          </div>

        </div>

      </div>
    </section>
  );
};
