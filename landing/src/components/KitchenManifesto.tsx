import React from 'react';

export const KitchenManifesto: React.FC = () => {
  return (
    <section id="manifiesto" className="py-24 sm:py-36 bg-dark-surface border-b border-dark-border relative overflow-hidden">
      <div className="max-w-5xl mx-auto px-6 sm:px-10">
        
        {/* Editorial Subheader */}
        <div className="font-mono text-[10px] sm:text-xs text-terracota uppercase tracking-widest-editorial mb-8 sm:mb-12 font-bold">
          [ 01 // LA REALIDAD DEL MOSTRADOR ]
        </div>

        {/* Monumental Manifesto Statement */}
        <div className="space-y-8 sm:space-y-12">
          
          <h2 className="font-serif italic font-normal text-paper-pure text-2xl sm:text-4xl md:text-5xl lg:text-6xl leading-[1.1] tracking-tight">
            "Comer bien es un acto sagrado. <br className="hidden sm:inline" />
            <span className="font-display font-bold not-italic text-paper-pure uppercase tracking-tightest">
              Gestionarlo no debería ser una tortura.
            </span>"
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-8 pt-8 border-t border-dark-border">
            
            {/* Left Narrative Column */}
            <div className="md:col-span-7 space-y-6 text-base sm:text-lg text-bone-muted font-sans font-light leading-relaxed">
              <p>
                Un restaurante vive en WhatsApp. Ahí se reservan las mesas de los fines de semana, 
                se piden los platos del día y se coordinan los envíos. 
                Pero a las 21:30 hs el salón arde: la plancha chilla, las copas tintinean y el equipo no da abasto.
              </p>
              <p className="text-paper-pure font-serif italic text-lg sm:text-xl leading-snug">
                El cliente que espera diez minutos en el teléfono ya le escribió al local de enfrente. 
                Y el dueño termina la jornada a las dos de la mañana cargando facturas a mano.
              </p>
            </div>

            {/* Right Contrast Column (Crisp White Paper Card) */}
            <div className="md:col-span-5 flex flex-col justify-between p-6 sm:p-8 bg-paper-pure text-tinta border border-paper-border space-y-6 rounded-sm shadow-xl">
              <div>
                <span className="font-mono text-[10px] uppercase tracking-widest text-terracota font-bold block mb-2">
                  EL PRINCIPIO FUNDACIONAL
                </span>
                <p className="text-xs sm:text-sm text-tinta-muted leading-relaxed font-sans font-normal">
                  BlendBot nació para devolverle el orden a la cocina: 
                  un motor que responde en dos segundos con tono natural, 
                  avisa si un corte se agotó y emite el comprobante fiscal al cobrar.
                </p>
              </div>

              <div className="pt-4 border-t border-paper-border flex justify-between items-center font-mono text-[10px] text-tinta-muted">
                <span>RESPUESTA: &lt; 2 SEG</span>
                <span className="text-terracota font-bold">100% CANAL PROPIO</span>
              </div>
            </div>

          </div>

        </div>

      </div>
    </section>
  );
};
