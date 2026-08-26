import React from 'react';
import { ArrowUpRight } from 'lucide-react';
import { sounds } from '../utils/audio';

interface MonumentalFooterProps {
  onOpenDemo: () => void;
}

export const MonumentalFooter: React.FC<MonumentalFooterProps> = ({ onOpenDemo }) => {
  const scrollToTop = () => {
    sounds.playClick();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <footer className="bg-dark-surface border-t border-dark-border relative pt-14 sm:pt-20 pb-10 sm:pb-12 overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-8 lg:px-10 relative z-10">
        
        {/* Top Closing CTA block */}
        <div className="border-b border-dark-border pb-12 sm:pb-16 mb-12 sm:mb-16 flex flex-col md:flex-row md:items-end justify-between gap-6 sm:gap-8">
          <div className="max-w-xl">
            <span className="font-mono text-[9px] sm:text-[10px] text-terracota uppercase tracking-widest-editorial block mb-1.5 sm:mb-2 font-bold">
              GASTRONOMÍA & BODEGAS // MENDOZA
            </span>
            <h2 className="font-serif italic font-normal text-paper-pure text-2xl xs:text-3xl sm:text-5xl font-bold tracking-tight">
              ¿Listo para equipar tu restaurante?
            </h2>
            <p className="mt-2 sm:mt-3 text-bone-muted font-sans text-xs sm:text-base font-light">
              Sumate a los locales de Mendoza que operan con reservas automáticas, comandera en cocina y facturación en regla.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4 font-mono text-xs">
            <button
              onClick={() => {
                sounds.playKitchenBell();
                onOpenDemo();
              }}
              className="w-full sm:w-auto px-6 sm:px-8 py-4 bg-terracota hover:bg-terracota-light text-white font-bold uppercase tracking-wider transition-all duration-200 active:scale-95 shadow-xl flex items-center justify-center gap-2 rounded-sm min-h-[48px]"
            >
              <span>Equipar mi Local en Mendoza</span>
              <ArrowUpRight className="w-4 h-4" />
            </button>

            <button
              onClick={scrollToTop}
              className="w-full sm:w-auto px-5 py-3.5 sm:py-4 border border-dark-border hover:border-terracota text-paper-pure hover:text-terracota uppercase tracking-wider transition-colors text-center rounded-sm bg-dark/50 min-h-[44px]"
            >
              Volver Arriba ↑
            </button>
          </div>
        </div>

        {/* Colophon & Credits Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 sm:gap-8 font-mono text-xs text-bone-muted border-b border-dark-border pb-10 sm:pb-12 mb-8 sm:mb-12">
          <div>
            <span className="text-paper-pure font-bold uppercase tracking-wider block mb-2 text-[11px] sm:text-xs">
              SISTEMA INTEGRAL
            </span>
            <ul className="space-y-1 text-bone-muted text-[10px] sm:text-xs">
              <li>• WhatsApp Oficial con IA</li>
              <li>• Comandera Táctil KDS</li>
              <li>• Switch 'SE ACABÓ'</li>
              <li>• Facturación Oficial ARCA</li>
            </ul>
          </div>

          <div>
            <span className="text-paper-pure font-bold uppercase tracking-wider block mb-2 text-[11px] sm:text-xs">
              VERTICALES MENDOZA
            </span>
            <ul className="space-y-1 text-bone-muted text-[10px] sm:text-xs">
              <li>• Restaurantes de Viñedo</li>
              <li>• Bodegas & Degustaciones</li>
              <li>• Bistrós & Hamburgueserías</li>
              <li>• Pizzerías & Bares</li>
            </ul>
          </div>

          <div>
            <span className="text-paper-pure font-bold uppercase tracking-wider block mb-2 text-[11px] sm:text-xs">
              INFRAESTRUCTURA
            </span>
            <ul className="space-y-1 text-bone-muted text-[10px] sm:text-xs">
              <li>• Meta Cloud API Homologado</li>
              <li>• Sidecar Criptográfico ARCA</li>
              <li>• Puesta en Marcha en 48hs</li>
              <li>• Uptime 99.98% 24/7</li>
            </ul>
          </div>

          <div>
            <span className="text-paper-pure font-bold uppercase tracking-wider block mb-2 text-[11px] sm:text-xs">
              CONTACTO & SEDE
            </span>
            <div className="space-y-1 text-bone-muted text-[10px] sm:text-xs">
              <div>Mendoza, Argentina</div>
              <div className="text-terracota font-bold">hola@blendbot.com.ar</div>
              <div className="text-[9px] sm:text-[10px] text-verde font-semibold mt-1.5">
                ● SERVICIO ACTIVO EN MENDOZA
              </div>
            </div>
          </div>
        </div>

        {/* Monumental Typographic Signature Banner (Vector Scalable SVG - 100% Fit in Any Screen) */}
        <div className="select-none py-4 sm:py-8 w-full flex items-center justify-center">
          <svg
            viewBox="0 0 1000 130"
            className="w-full h-auto text-dark-border hover:text-dark-hover transition-colors duration-500 fill-current"
            aria-label="BLENDBOT"
          >
            <text
              x="50%"
              y="54%"
              dominantBaseline="middle"
              textAnchor="middle"
              className="font-serif font-black tracking-tight"
              fontSize="120"
            >
              BLENDBOT
            </text>
          </svg>
        </div>

        {/* Bottom Colophon Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 font-mono text-[10px] sm:text-[11px] text-bone-muted pt-4 border-t border-dark-border text-center sm:text-left">
          <div>
            © 2026 BLENDBOT GASTRONOMÍA · MENDOZA, ARGENTINA.
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-terracota" />
            <span>Desarrollado para la gastronomía de Mendoza</span>
          </div>
        </div>

      </div>
    </footer>
  );
};
