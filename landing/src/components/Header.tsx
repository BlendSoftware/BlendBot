import React, { useState, useEffect } from 'react';
import { LogIn } from 'lucide-react';

interface HeaderProps {
  onOpenDemo: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onOpenDemo }) => {
  const [isScrolled, setIsScrolled] = useState<boolean>(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleLoginClick = () => {
    if (window.location.port === '5173') {
      window.location.href = 'http://localhost:5174/login';
    } else {
      window.location.href = '/panel/login';
    }
  };

  return (
    <header className={`fixed top-0 left-0 right-0 z-40 transition-all duration-300 ${
      isScrolled 
        ? 'bg-dark/95 backdrop-blur-md border-b border-dark-border py-2.5 sm:py-3.5 shadow-sm' 
        : 'bg-gradient-to-b from-dark via-dark/90 to-transparent py-3 sm:py-5'
    }`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-8 lg:px-10">
        
        {/* Top Micro-Bar (Desktop Only) */}
        {!isScrolled && (
          <div className="hidden md:flex items-center justify-between pb-2.5 mb-2.5 border-b border-dark-border/40 font-ancha text-[9px] uppercase tracking-widest text-bone-muted/80">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-verde animate-pulse" />
              <span>SISTEMA GASTRONÓMICO OPERATIVO</span>
            </div>
            <div className="flex items-center gap-4">
              <span>MENDOZA, ARGENTINA</span>
            </div>
          </div>
        )}

        {/* Main Navbar */}
        <div className="flex items-center justify-between gap-2">
          
          {/* Brand Seal */}
          <a 
            href="/"
            aria-label="BlendBot, inicio"
            className="flex items-center gap-2 sm:gap-3 group flex-shrink-0"
          >
            <img
              src="/logo-blend-mark.svg"
              alt="Blend Software"
              className="w-8 h-8 sm:w-10 sm:h-10 object-contain group-hover:scale-105 transition-transform flex-shrink-0"
            />
            <div className="flex flex-col">
              <span className="font-serif font-bold text-lg sm:text-2xl text-tinta tracking-tight leading-none group-hover:text-terracota transition-colors">
                BlendBot
              </span>
              <span className="font-ancha text-[8px] sm:text-[9px] uppercase tracking-[0.2em] text-bone-muted mt-0.5">
                Mendoza
              </span>
            </div>
          </a>

          {/* Clean Navigation Actions (Mobile-Optimized Touch Targets) */}
          <div className="flex items-center gap-2 sm:gap-4 font-ancha text-xs">
            
            {/* Ingresar Button (Login to Panel) */}
            <button
              onClick={handleLoginClick}
              className="flex items-center gap-1 px-2.5 sm:px-3.5 py-2 text-tinta hover:text-terracota hover:border-terracota border border-dark-border/80 rounded-sm transition-all duration-200 bg-dark-surface/80 active:scale-95 text-[11px] sm:text-xs min-h-[38px] sm:min-h-[40px]"
              aria-label="Ingresar al Panel"
            >
              <LogIn className="w-3.5 h-3.5 text-terracota flex-shrink-0" />
              <span>Ingresar</span>
            </button>

            {/* Pedir Prueba / Equipar CTA */}
            <button
              onClick={() => {
                onOpenDemo();
              }}
              className="px-3 sm:px-5 py-2 bg-tinta text-white hover:bg-terracota hover:text-white font-bold uppercase tracking-wider rounded-sm transition-all duration-200 active:scale-95 shadow-md text-[11px] sm:text-xs min-h-[38px] sm:min-h-[40px] flex items-center justify-center whitespace-nowrap"
            >
              Equipar Local
            </button>

          </div>

        </div>

      </div>
    </header>
  );
};
