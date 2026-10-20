import React from 'react';
import { ArrowDownRight, Check, ChevronRight } from 'lucide-react';

interface HeroProps {
  onOpenSimulator: () => void;
  onOpenDemo: () => void;
}

export const Hero: React.FC<HeroProps> = ({ onOpenSimulator, onOpenDemo }) => {
  return (
    <section id="hero" className="relative pt-24 sm:pt-36 pb-16 sm:pb-24 border-b border-dark-border bg-dark overflow-hidden">
      
      {/* Subtle Warm Atmospheric Glow */}
      <div className="absolute top-1/4 -right-40 w-[350px] sm:w-[600px] h-[350px] sm:h-[600px] bg-terracota/10 rounded-full blur-[100px] sm:blur-[140px] pointer-events-none" />
      <div className="absolute -bottom-20 -left-40 w-[300px] sm:w-[500px] h-[300px] sm:h-[500px] bg-logo-gold/10 rounded-full blur-[100px] sm:blur-[120px] pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-8 lg:px-10 relative z-10">
        
        {/* Top Editorial Index Bar (Mobile Optimized) */}
        <div className="flex items-center justify-between gap-2 border-b border-dark-border/60 pb-3 sm:pb-4 mb-8 sm:mb-12 font-ancha text-[9px] sm:text-[11px] text-bone-muted uppercase tracking-[0.12em]">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-terracota animate-pulse" />
            <span className="text-tinta font-bold tracking-wider">MENDOZA // 2026</span>
          </div>
          <div className="hidden sm:flex items-center gap-4 text-bone-muted/80">
            <span>01. WHATSAPP IA</span>
            <span>·</span>
            <span>02. COMANDERA</span>
            <span>·</span>
            <span>03. ARCA FISCAL</span>
          </div>
          <div className="text-terracota font-bold text-right text-[9px] sm:text-[11px]">
            MENDOZA
          </div>
        </div>

        {/* Monumental Hero Title */}
        <div className="max-w-5xl mb-10 sm:mb-14">
          
          {/* Promesa corta arriba del título: lo que el dueño quiere saber
              antes de leer nada más (cuánto tarda y cuánto se lleva). */}
          <div className="inline-flex items-center gap-2 sm:gap-2.5 mb-4 sm:mb-6 py-1 pl-1 pr-3 sm:pr-4 rounded-full bg-white border border-terracota/20 shadow-sm font-ancha text-[9px] sm:text-[11px] uppercase tracking-wider text-tinta">
            <span className="inline-flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-full bg-terracota text-white font-bold">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-70" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
              </span>
              Llave en mano
            </span>
            <span>Funcionando en 48 hs · <span className="text-terracota font-bold">0% comisión</span></span>
          </div>

          <h1 className="font-serif font-semibold text-tinta text-[2.2rem] xs:text-[2.6rem] sm:text-[4.2rem] md:text-[5.4rem] lg:text-[6.4rem] leading-[0.92] tracking-tight">
            El sistema completo <br />
            <span className="font-display font-black text-tinta uppercase tracking-tightest block mt-1 sm:mt-2">
              de tu restaurante.
            </span>
          </h1>

          <p className="mt-4 sm:mt-6 text-sm sm:text-lg lg:text-xl text-bone-muted max-w-2xl font-sans font-normal leading-relaxed">
            Atención y reservas 24/7 por WhatsApp para locales y turistas, 
            comandera táctil de cocina con switch de stock al instante y <strong className="text-tinta font-semibold underline decoration-terracota decoration-2 underline-offset-4">facturación automática de ARCA</strong> al cobrar.
          </p>

          {/* Action Buttons (Full width on mobile, inline on tablet+) */}
          <div className="mt-6 sm:mt-8 flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4 font-ancha text-xs">
            <button
              onClick={() => {
                onOpenDemo();
              }}
              className="w-full sm:w-auto px-6 py-4 bg-terracota hover:bg-terracota-light text-white font-bold uppercase tracking-wider rounded-sm transition-all duration-200 active:scale-95 shadow-sm flex items-center justify-center gap-2 min-h-[48px]"
            >
              <span>Equipar mi Local en Mendoza</span>
              <ChevronRight className="w-4 h-4" />
            </button>

            <button
              onClick={() => {
                onOpenSimulator();
              }}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-4 border border-dark-border hover:border-terracota text-tinta hover:text-terracota rounded-sm transition-colors active:scale-95 bg-dark-surface/60 min-h-[48px]"
            >
              <span>Ver los Módulos del Sistema</span>
              <ArrowDownRight className="w-4 h-4 text-terracota" />
            </button>
          </div>

        </div>

        {/* Architectural 3-Pillar Visual Showcase (Mobile Responsive Grid) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6 items-stretch pt-2 sm:pt-4">
          
          {/* Main Visual: Gastronomic Atmosphere (7 cols) */}
          <div className="lg:col-span-7 relative group overflow-hidden bg-dark-card border border-dark-border rounded-sm min-h-[280px] sm:min-h-[420px] shadow-sm flex flex-col justify-between">
            
            <img 
              src="https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=1400&q=85" 
              alt="Servicio y cocina a las brasas en Mendoza" 
              className="absolute inset-0 w-full h-full object-cover filter saturate-[0.85] contrast-[1.15] group-hover:scale-105 transition-transform duration-1000"
              // React 18 no conoce `fetchPriority` y lo descarta: en minúscula
              // llega al HTML y el navegador baja esta imagen (el LCP) primero.
              {...{ fetchpriority: 'high' }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-dark/95 via-dark/40 to-transparent" />

            {/* Top Badge */}
            <div className="relative z-10 p-4 sm:p-6 flex justify-between items-start">
              <span className="px-2.5 py-1 bg-dark/80 backdrop-blur-md border border-dark-border font-ancha text-[9px] sm:text-[10px] text-tinta uppercase font-bold tracking-wider rounded-sm">
                SERVICIO EN VIVO // MENDOZA
              </span>
              <span className="px-2 py-1 bg-terracota text-white font-ancha text-[8px] sm:text-[9px] font-bold uppercase tracking-widest rounded-sm">
                0% COMISIÓN
              </span>
            </div>

            {/* Bottom Floating White Paper Plate */}
            <div className="relative z-10 p-3.5 sm:p-6">
              <div className="bg-paper-pure text-tinta border border-paper-border p-3.5 sm:p-5 rounded-sm shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <span className="font-ancha text-[8px] sm:text-[9px] uppercase tracking-widest text-terracota font-bold block mb-0.5">
                    INSTALACIÓN INTEGRAL LLAVE EN MANO
                  </span>
                  <div className="font-serif font-bold text-sm sm:text-lg text-tinta leading-tight">
                    Tu restaurante operando sin fricción en 48hs
                  </div>
                </div>
                <div className="font-ancha text-[10px] sm:text-xs text-verde font-bold flex items-center gap-1.5 flex-shrink-0">
                  <Check className="w-3.5 h-3.5" />
                  <span>SISTEMA 100% ACTIVO</span>
                </div>
              </div>
            </div>

          </div>

          {/* Right Column: Mini Interactive Station Feed (5 cols) */}
          <div className="lg:col-span-5 flex flex-col justify-between gap-3 sm:gap-4">
            
            {/* Card 1: WhatsApp Assistant Feed */}
            <div className="bg-dark-card border border-dark-border p-4 sm:p-5 rounded-sm shadow-sm space-y-2">
              <div className="flex items-center justify-between font-ancha text-[9px] sm:text-[10px] text-bone-muted border-b border-dark-border pb-1.5 sm:pb-2">
                <span className="text-tinta font-bold">01 // WHATSAPP CONVERSACIONAL</span>
                <span className="text-verde">Respuesta &lt; 2s</span>
              </div>
              <p className="font-serif text-xs sm:text-sm text-bone-muted leading-relaxed">
                «Hola! Tienen lugar para 4 hoy a las 21:30 en el patio?»
              </p>
              <div className="bg-dark-surface p-2.5 sm:p-3 border-l-2 border-terracota rounded-sm text-xs font-sans text-tinta">
                <strong className="text-terracota font-ancha block text-[9px] sm:text-[10px] mb-0.5">BLEND ASISTENTE:</strong>
                «¡Confirmada la Mesa 6 en el patio para 4 personas! Ya está agendada a tu nombre.»
              </div>
            </div>

            {/* Card 2: Kitchen KDS Quick Status */}
            <div className="bg-dark-card border border-dark-border p-4 sm:p-5 rounded-sm shadow-sm space-y-2">
              <div className="flex items-center justify-between font-ancha text-[9px] sm:text-[10px] text-bone-muted border-b border-dark-border pb-1.5 sm:pb-2">
                <span className="text-tinta font-bold">02 // COMANDERA DE COCINA</span>
                <span className="text-terracota font-bold">SWITCH STOCK EN VIVO</span>
              </div>
              <div className="flex items-center justify-between text-xs font-sans">
                <span className="text-bone-muted font-medium">Ojo de Bife a la Brasa:</span>
                <span className="px-2 py-0.5 bg-verde/20 text-verde border border-verde/30 font-ancha text-[9px] sm:text-[10px] rounded-sm font-bold">
                  DISPONIBLE
                </span>
              </div>
            </div>

            {/* Card 3: ARCA Fiscal Invoice Speed */}
            <div className="bg-dark-card border border-dark-border p-4 sm:p-5 rounded-sm shadow-sm space-y-2">
              <div className="flex items-center justify-between font-ancha text-[9px] sm:text-[10px] text-bone-muted border-b border-dark-border pb-1.5 sm:pb-2">
                <span className="text-tinta font-bold">03 // FACTURACIÓN OFICIAL ARCA</span>
                <span className="text-verde font-bold">CAE HOMOLOGADO</span>
              </div>
              <div className="flex items-center justify-between text-xs font-ancha text-bone-muted">
                <span>Factura B #0004-001849</span>
                <span className="text-tinta font-bold text-terracota">$38.000,00</span>
              </div>
            </div>

          </div>

        </div>

      </div>
    </section>
  );
};
