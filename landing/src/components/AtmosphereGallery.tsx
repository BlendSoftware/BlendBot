import React from 'react';

export const AtmosphereGallery: React.FC = () => {
  return (
    <section className="py-24 sm:py-36 bg-dark border-b border-dark-border overflow-hidden relative">
      
      {/* Subtle atmospheric light */}
      <div className="absolute top-1/2 left-1/3 w-[500px] h-[500px] bg-terracota/5 rounded-full blur-[140px] pointer-events-none" />

      <div className="max-w-7xl mx-auto px-6 sm:px-10 relative z-10">
        
        {/* Section Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-16">
          <div>
            <div className="font-mono text-[10px] sm:text-xs text-terracota uppercase tracking-widest-editorial mb-3 font-bold flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-terracota" />
              <span>[ 04 // CRÓNICA VISUAL // 35MM ]</span>
            </div>
            <h2 className="font-serif font-semibold text-tinta text-3xl sm:text-5xl font-bold tracking-tight">
              La gastronomía y el vino en Mendoza.
            </h2>
          </div>
          <div className="font-mono text-xs text-bone-muted max-w-xs leading-relaxed">
            Registro espontáneo del despacho en bodegas y salones: fuegos de quebracho, copas llenas y comandas cumplidas.
          </div>
        </div>

        {/* Asymmetric Photographic Collage */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-4 sm:gap-6">
          
          {/* Photo 1: Big Hero Cut (7 cols) */}
          <div className="lg:col-span-7 relative group overflow-hidden bg-dark-card border border-dark-border min-h-[360px] sm:min-h-[460px] rounded-sm shadow-sm">
            <img 
              src="https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=1200&q=80" 
              alt="Mesa y servicio gastronómico nocturno en Mendoza"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-1000 filter saturate-[0.85] contrast-[1.1]"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-dark/80 via-transparent to-transparent" />
            <div className="absolute bottom-4 left-4 right-4 bg-paper-pure text-tinta p-3.5 border border-paper-border flex justify-between items-center font-mono text-[10px] rounded-sm shadow-sm">
              <span className="font-bold">PASE 01 // SERVICIO DE LAS 21:30 HS</span>
              <span className="text-terracota font-bold">MENDOZA</span>
            </div>
          </div>

          {/* Photo 2: Wine and Glasses (5 cols) */}
          <div className="lg:col-span-5 relative group overflow-hidden bg-dark-card border border-dark-border min-h-[360px] sm:min-h-[460px] rounded-sm shadow-sm">
            <img 
              src="https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?auto=format&fit=crop&w=1000&q=80" 
              alt="Copas de vino y servicio de salón en bodega"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-1000 filter saturate-[0.85] contrast-[1.1]"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-dark/80 via-transparent to-transparent" />
            <div className="absolute bottom-4 left-4 right-4 bg-paper-pure text-tinta p-3.5 border border-paper-border flex justify-between items-center font-mono text-[10px] rounded-sm shadow-sm">
              <span className="font-bold">VINOS & DEGUSTACIONES</span>
              <span className="text-terracota font-bold">RESERVAS EN VIVO</span>
            </div>
          </div>

          {/* Photo 3: Kitchen Hand Craft (6 cols) */}
          <div className="lg:col-span-6 relative group overflow-hidden bg-dark-card border border-dark-border h-[300px] rounded-sm shadow-sm">
            <img 
              src="https://images.unsplash.com/photo-1577219491135-ce391730fb2c?auto=format&fit=crop&w=900&q=80" 
              alt="Cocina y despacho gastronómico"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-1000 filter saturate-[0.85]"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-dark/80 via-transparent to-transparent" />
            <div className="absolute bottom-3 left-3 bg-paper-pure text-tinta px-3 py-1.5 border border-paper-border font-mono text-[10px] font-bold rounded-sm shadow-md">
              PASE DE COCINA // DESPACHO TÁCTIL
            </div>
          </div>

          {/* Photo 4: Cashier & Fast Closing (6 cols) */}
          <div className="lg:col-span-6 relative group overflow-hidden bg-dark-card border border-dark-border h-[300px] rounded-sm shadow-sm">
            <img 
              src="https://images.unsplash.com/photo-1556740758-90de374c12ad?auto=format&fit=crop&w=900&q=80" 
              alt="Cobro rápido y factura fiscal ARCA"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-1000 filter saturate-[0.85]"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-dark/80 via-transparent to-transparent" />
            <div className="absolute bottom-3 left-3 bg-paper-pure text-tinta px-3 py-1.5 border border-paper-border font-mono text-[10px] font-bold rounded-sm shadow-md">
              COMPROBANTE FISCAL ARCA INMEDIATO
            </div>
          </div>

        </div>

      </div>
    </section>
  );
};
