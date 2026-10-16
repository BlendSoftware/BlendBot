import React, { useState } from 'react';
import { FAQ_DATA } from '../data/faqData';
import { ChevronDown } from 'lucide-react';

export const FaqSection: React.FC = () => {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const toggleAccordion = (idx: number) => {
    setOpenIndex(openIndex === idx ? null : idx);
  };

  return (
    <section className="py-16 sm:py-36 bg-dark border-b border-dark-border">
      <div className="max-w-4xl mx-auto px-4 sm:px-8 lg:px-10">
        
        {/* Header */}
        <div className="mb-10 sm:mb-16">
          <div className="font-mono text-[9px] sm:text-xs text-terracota uppercase tracking-widest-editorial mb-2 sm:mb-3 font-bold flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-terracota" />
            <span>[ 06 // PREGUNTAS DEL MOSTRADOR ]</span>
          </div>
          <h2 className="font-serif font-semibold text-tinta text-2xl xs:text-3xl sm:text-5xl font-bold tracking-tight">
            Respuestas sin vueltas.
          </h2>
          <p className="mt-2 sm:mt-3 text-xs sm:text-sm text-bone-muted font-sans font-normal">
            Todo lo necesario para equipar tu restaurante o bodega en Mendoza con BlendBot.
          </p>
        </div>

        {/* Accordion List */}
        <div className="space-y-3 sm:space-y-4 font-sans">
          {FAQ_DATA.map((faq, idx) => {
            const isOpen = openIndex === idx;
            return (
              <div 
                key={idx}
                className="bg-dark-surface border border-dark-border rounded-sm overflow-hidden transition-all duration-200"
              >
                <button
                  onClick={() => toggleAccordion(idx)}
                  className="w-full p-4 sm:p-6 text-left flex items-center justify-between gap-3 font-serif font-bold text-sm sm:text-lg text-tinta hover:text-terracota transition-colors min-h-[48px]"
                  aria-expanded={isOpen}
                >
                  <span className="flex items-center gap-3 sm:gap-4">
                    <span className="font-mono text-[11px] sm:text-xs text-terracota font-bold">0{idx + 1}</span>
                    <span>{faq.question}</span>
                  </span>
                  <ChevronDown className={`w-4 h-4 text-bone-muted transition-transform duration-300 flex-shrink-0 ${
                    isOpen ? 'rotate-180 text-terracota' : ''
                  }`} />
                </button>

                {isOpen && (
                  <div className="px-4 pb-4 sm:px-6 sm:pb-6 text-xs sm:text-sm text-bone-muted leading-relaxed border-t border-dark-border pt-3 sm:pt-4 font-sans font-normal bg-dark-card/50">
                    <p>{faq.answer}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>

      </div>
    </section>
  );
};
