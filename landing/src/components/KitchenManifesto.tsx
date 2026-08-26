import React from 'react';

export const KitchenManifesto: React.FC = () => {
  return (
    <section id="manifiesto" className="py-16 sm:py-36 bg-dark-surface border-b border-dark-border relative overflow-hidden">
      <div className="max-w-5xl mx-auto px-4 sm:px-8 lg:px-10">
        
        {/* Editorial Subheader */}
        <div className="font-mono text-[9px] sm:text-xs text-terracota uppercase tracking-widest-editorial mb-6 sm:mb-12 font-bold flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-terracota" />
          <span>[ 01 // EL DESAFÍO EN MENDOZA ]</span>
        </div>

        {/* Monumental Manifesto Statement */}
        <div className="space-y-6 sm:space-y-12">
          
          <h2 className="font-serif italic font-normal text-paper-pure text-xl xs:text-2xl sm:text-4xl md:text-5xl lg:text-6xl leading-[1.15] tracking-tight">
            "La gastronomía de Mendoza creció. <br className="hidden sm:inline" />
            <span className="font-display font-bold not-italic text-paper-pure uppercase tracking-tightest">
              Las herramientas de trabajo tienen que estar a la altura.
            </span>"
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 sm:gap-8 pt-6 sm:pt-8 border-t border-dark-border">
            
            {/* Left Narrative Column */}
            <div className="md:col-span-7 space-y-4 sm:space-y-6 text-sm sm:text-lg text-bone-muted font-sans font-light leading-relaxed">
              <p>
                En Mendoza conviven el comensal local y el turismo nacional e internacional. 
                El teléfono no para con consultas de cartas de vino, menús de pasos, 
                reservas para el fin de semana y pedidos de despacho.
              </p>
              <p className="text-paper-pure font-serif italic text-base sm:text-xl leading-snug">
                Un viernes a la noche en Arístides, Chacras o el Valle de Uco, demorarse diez minutos en responder 
                es una mesa que se pierde. Y cerrar el día cargando facturas a mano en la web de AFIP a las dos de la mañana es insostenible.
              </p>
            </div>

            {/* Right Contrast Column (Crisp White Paper Card) */}
            <div className="md:col-span-5 flex flex-col justify-between p-5 sm:p-8 bg-paper-pure text-tinta border border-paper-border space-y-4 sm:space-y-6 rounded-sm shadow-xl">
              <div>
                <span className="font-mono text-[9px] sm:text-[10px] uppercase tracking-widest text-terracota font-bold block mb-1.5 sm:mb-2">
                  LA SOLUCIÓN INTEGRAL
                </span>
                <p className="text-xs sm:text-sm text-tinta-muted leading-relaxed font-sans font-normal">
                  Equipamos todo tu local: el WhatsApp que responde y reserva al instante, 
                  la comandera de cocina donde pausás platos con un toque y el motor que emite la factura de ARCA al cobrar.
                </p>
              </div>

              <div className="pt-3 sm:pt-4 border-t border-paper-border flex justify-between items-center font-mono text-[9px] sm:text-[10px] text-tinta-muted">
                <span>RESPUESTA: &lt; 2 SEG</span>
                <span className="text-terracota font-bold">MENDOZA 100% ACTIVO</span>
              </div>
            </div>

          </div>

        </div>

      </div>
    </section>
  );
};
