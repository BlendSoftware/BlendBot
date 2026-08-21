import React, { useState } from 'react';
import { FAQ_DATA } from '../data/faqData';
import { ChevronDown } from 'lucide-react';
import { sounds } from '../utils/audio';

export const FaqSection: React.FC = () => {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const toggleAccordion = (idx: number) => {
    sounds.playClick();
    setOpenIndex(openIndex === idx ? null : idx);
  };

  return (
    <section className="py-24 sm:py-36 bg-dark border-b border-dark-border">
      <div className="max-w-4xl mx-auto px-6 sm:px-10">
        
        {/* Header */}
        <div className="mb-16">
          <div className="font-mono text-[10px] sm:text-xs text-terracota uppercase tracking-widest-editorial mb-3 font-bold">
            [ 06 // PREGUNTAS DEL MOSTRADOR ]
          </div>
          <h2 className="font-serif italic font-normal text-paper-pure text-3xl sm:text-5xl font-bold tracking-tight">
            Respuestas sin vueltas.
          </h2>
          <p className="mt-3 text-sm text-bone-muted font-sans font-light">
            Todo lo necesario antes de incorporar BlendBot a la rutina de tu cocina.
          </p>
        </div>

        {/* Accordion List */}
        <div className="space-y-4 font-sans">
          {FAQ_DATA.map((faq, idx) => {
            const isOpen = openIndex === idx;
            return (
              <div 
                key={idx}
                className="bg-dark-surface border border-dark-border rounded-sm overflow-hidden transition-all duration-200"
              >
                <button
                  onClick={() => toggleAccordion(idx)}
                  className="w-full p-5 sm:p-6 text-left flex items-center justify-between gap-4 font-serif italic font-bold text-base sm:text-lg text-paper-pure hover:text-terracota transition-colors"
                  aria-expanded={isOpen}
                >
                  <span className="flex items-center gap-4">
                    <span className="font-mono text-xs text-terracota font-normal not-italic font-bold">0{idx + 1}</span>
                    <span>{faq.question}</span>
                  </span>
                  <ChevronDown className={`w-4 h-4 text-bone-muted transition-transform duration-300 flex-shrink-0 ${
                    isOpen ? 'rotate-180 text-terracota' : ''
                  }`} />
                </button>

                {isOpen && (
                  <div className="px-5 pb-6 sm:px-6 sm:pb-6 text-xs sm:text-sm text-bone-muted leading-relaxed border-t border-dark-border pt-4 font-sans font-light bg-dark-card/50">
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
