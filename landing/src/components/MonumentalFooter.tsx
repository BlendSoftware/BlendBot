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
    <footer className="bg-dark-surface border-t border-dark-border relative pt-20 pb-12 overflow-hidden">
      <div className="max-w-7xl mx-auto px-6 sm:px-10 relative z-10">
        
        {/* Top Closing CTA block */}
        <div className="border-b border-dark-border pb-16 mb-16 flex flex-col md:flex-row md:items-end justify-between gap-8">
          <div className="max-w-xl">
            <span className="font-mono text-[10px] text-terracota uppercase tracking-widest-editorial block mb-2 font-bold">
              FIN DE SERVICIO // 02:00 AM
            </span>
            <h2 className="font-serif italic font-normal text-paper-pure text-3xl sm:text-5xl font-bold tracking-tight">
              ¿Listo para ordenar la noche?
            </h2>
            <p className="mt-3 text-bone-muted font-sans text-sm sm:text-base font-light">
              Sumate al grupo selecto de locales gastronómicos que despachan con serenidad y sin comisiones del 30%.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 font-mono text-xs">
            <button
              onClick={() => {
                sounds.playKitchenBell();
                onOpenDemo();
              }}
              className="px-8 py-4 bg-paper-pure text-tinta hover:bg-terracota hover:text-white font-bold uppercase tracking-wider transition-all duration-200 active:scale-95 shadow-xl flex items-center justify-center gap-2 rounded-sm"
            >
              <span>Activar Prueba en mi Local</span>
              <ArrowUpRight className="w-4 h-4" />
            </button>

            <button
              onClick={scrollToTop}
              className="px-5 py-4 border border-dark-border hover:border-terracota text-paper-pure hover:text-terracota uppercase tracking-wider transition-colors text-center rounded-sm bg-dark/50"
            >
              Volver Arriba ↑
            </button>
          </div>
        </div>

        {/* Colophon & Credits Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 font-mono text-xs text-bone-muted border-b border-dark-border pb-12 mb-12">
          <div>
            <span className="text-paper-pure font-bold uppercase tracking-wider block mb-2">
              SISTEMA
            </span>
            <ul className="space-y-1 text-bone-muted">
              <li>• WhatsApp Conversacional</li>
              <li>• Tablet Touch de Despacho</li>
              <li>• Switch 'SE ACABÓ'</li>
              <li>• Facturación Homologada ARCA</li>
            </ul>
          </div>

          <div>
            <span className="text-paper-pure font-bold uppercase tracking-wider block mb-2">
              VERTICALES
            </span>
            <ul className="space-y-1 text-bone-muted">
              <li>• Hamburgueserías de Autor</li>
              <li>• Pizzerías & Empanadas</li>
              <li>• Cafés de Especialidad</li>
              <li>• Bares & Parrillas</li>
            </ul>
          </div>

          <div>
            <span className="text-paper-pure font-bold uppercase tracking-wider block mb-2">
              INFRAESTRUCTURA
            </span>
            <ul className="space-y-1 text-bone-muted">
              <li>• WhatsApp Cloud API Oficial</li>
              <li>• Sidecar Criptográfico ARCA</li>
              <li>• Latencia &lt; 1.8s x mensaje</li>
              <li>• Uptime 99.98% 24/7</li>
            </ul>
          </div>

          <div>
            <span className="text-paper-pure font-bold uppercase tracking-wider block mb-2">
              CONTACTO & SEDE
            </span>
            <div className="space-y-1 text-bone-muted">
              <div>Buenos Aires, Argentina</div>
              <div className="text-terracota font-bold">hola@blendbot.com.ar</div>
              <div className="text-[10px] text-verde font-semibold mt-2">
                ● SERVICIO OPERATIVO
              </div>
            </div>
          </div>
        </div>

        {/* Monumental Typographic Signature Banner */}
        <div className="select-none py-6 text-center overflow-hidden">
          <div className="font-serif font-black text-[15vw] leading-[0.8] tracking-tighter text-dark-border hover:text-dark-hover transition-colors uppercase">
            BLENDBOT
          </div>
        </div>

        {/* Bottom Colophon Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 font-mono text-[11px] text-bone-muted pt-4 border-t border-dark-border">
          <div>
            © 2026 BLENDBOT GASTRONOMÍA. Todos los derechos reservados.
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-terracota" />
            <span>Hecho con hospitalidad y código en Buenos Aires</span>
          </div>
        </div>

      </div>
    </footer>
  );
};
