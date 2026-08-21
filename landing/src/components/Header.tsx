import React, { useState, useEffect } from 'react';
import { LogIn } from 'lucide-react';
import { sounds } from '../utils/audio';

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
    sounds.playClick();
    // El panel se sirve bajo /panel/ del mismo servidor (ver panel/nginx.conf
    // y panel/vite.config.ts, base: '/panel/'). No es otro puerto ni /login
    // a secas: eso cae en la landing, no en el panel.
    window.location.href = '/panel/login';
  };

  return (
    <header className={`fixed top-0 left-0 right-0 z-40 transition-all duration-300 ${
      isScrolled ? 'bg-dark/95 backdrop-blur-md border-b border-dark-border py-4 shadow-xl' : 'bg-transparent py-6'
    }`}>
      <div className="max-w-7xl mx-auto px-6 sm:px-10 flex items-center justify-between">
        
        {/* Brand Name */}
        <a 
          href="#" 
          className="flex items-baseline gap-2.5 group"
        >
          <div className="w-2.5 h-2.5 rounded-full bg-terracota group-hover:scale-125 transition-transform" />
          <span className="font-serif italic font-bold text-2xl text-paper-pure tracking-tight group-hover:text-terracota transition-colors">
            Blend
          </span>
          <span className="font-mono text-[9px] uppercase tracking-widest text-bone-muted">
            / Copiloto
          </span>
        </a>

        {/* Minimal Navigation & Actions */}
        <div className="flex items-center gap-3 sm:gap-5 font-mono text-xs">
          
          {/* Ingresar Button (Login to Panel) */}
          <button
            onClick={handleLoginClick}
            className="flex items-center gap-1.5 px-3.5 py-2 text-paper-pure hover:text-terracota hover:border-terracota border border-dark-border rounded-sm transition-all duration-200 bg-dark-surface/50"
          >
            <LogIn className="w-3.5 h-3.5 text-terracota" />
            <span>Ingresar</span>
          </button>

          {/* Pedir Prueba CTA */}
          <button
            onClick={() => {
              sounds.playClick();
              onOpenDemo();
            }}
            className="px-4 py-2 bg-paper-pure text-tinta hover:bg-terracota hover:text-white font-bold uppercase tracking-wider rounded-sm transition-all duration-200 active:scale-95 shadow-md"
          >
            Pedir Prueba
          </button>

        </div>

      </div>
    </header>
  );
};
