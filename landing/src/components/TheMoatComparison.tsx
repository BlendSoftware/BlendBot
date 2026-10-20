import React from 'react';
import { COMPARISON_DATA } from '../data/comparisonData';
import { Check, X, Sparkles, TrendingUp } from 'lucide-react';

export const TheMoatComparison: React.FC = () => {
  return (
    <section id="el-foso" className="py-24 sm:py-36 bg-carbon relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Header */}
        <div className="max-w-3xl mb-14">
          <div className="inline-flex items-center gap-2 font-ancha text-xs text-ember uppercase tracking-widest mb-3">
            <span className="w-2 h-2 bg-ember rounded-full" />
            <span>El Foso Competitivo // Por qué no hay nada igual</span>
          </div>
          <h2 className="font-display text-3xl sm:text-5xl font-extrabold uppercase text-bone tracking-tightest leading-tight">
            Contestar mensajes lo hace cualquiera. <br />
            <span className="text-ember font-serif font-normal">Cerrar el circuito fiscal y de cocina, no.</span>
          </h2>
          <p className="mt-4 text-base text-bone-muted font-sans">
            Las apps de delivery te cobran comisiones confiscatorias y se quedan con tus clientes. 
            Los bots genéricos no saben qué hay en cocina. BlendBot resuelve el circuito completo.
          </p>
        </div>

        {/* Comparison Table */}
        <div className="overflow-x-auto border border-carbon-border bg-carbon-surface rounded-sm shadow-sm">
          <table className="w-full text-left border-collapse font-sans text-xs sm:text-sm">
            
            {/* Table Head */}
            <thead>
              <tr className="border-b border-carbon-border bg-carbon-deep font-ancha text-[11px] uppercase tracking-wider text-bone-muted">
                <th className="py-4 px-4 sm:px-6 font-semibold w-1/3">Capacidad Operativa</th>
                <th className="py-4 px-4 sm:px-6 text-ember font-bold bg-ember/10 border-x border-ember/20 w-1/4">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>BlendBot (Copiloto)</span>
                  </div>
                </th>
                <th className="py-4 px-4 sm:px-6 w-1/5 text-stone-400">Apps de Delivery (PedidosYa)</th>
                <th className="py-4 px-4 sm:px-6 w-1/5 text-stone-400">Chatbots Genéricos</th>
              </tr>
            </thead>

            {/* Table Body */}
            <tbody className="divide-y divide-carbon-border">
              {COMPARISON_DATA.map((row, idx) => (
                <tr key={idx} className="hover:bg-carbon-hover/50 transition-colors">
                  
                  {/* Feature Title */}
                  <td className="py-4 px-4 sm:px-6">
                    <div className="font-semibold text-bone">{row.feature}</div>
                    <div className="font-ancha text-[10px] text-bone-muted/60 uppercase mt-0.5">{row.category}</div>
                  </td>

                  {/* BlendBot Column (Highlighted) */}
                  <td className="py-4 px-4 sm:px-6 bg-ember/5 border-x border-ember/20">
                    <div className="flex items-start gap-2">
                      <div className="w-4 h-4 rounded-full bg-ember/20 text-ember flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Check className="w-2.5 h-2.5" />
                      </div>
                      <span className="font-semibold text-bone">{row.blendbot.text}</span>
                    </div>
                  </td>

                  {/* PedidosYa Column */}
                  <td className="py-4 px-4 sm:px-6 text-stone-400">
                    <div className="flex items-start gap-2">
                      <div className="w-4 h-4 rounded-full bg-red-950/40 text-red-400 flex items-center justify-center flex-shrink-0 mt-0.5">
                        {row.pedidosYa.status ? <Check className="w-2.5 h-2.5" /> : <X className="w-2.5 h-2.5" />}
                      </div>
                      <span>{row.pedidosYa.text}</span>
                    </div>
                  </td>

                  {/* Generic Bots Column */}
                  <td className="py-4 px-4 sm:px-6 text-stone-400">
                    <div className="flex items-start gap-2">
                      <div className="w-4 h-4 rounded-full bg-stone-800 text-stone-400 flex items-center justify-center flex-shrink-0 mt-0.5">
                        {row.genericBot.status ? <Check className="w-2.5 h-2.5" /> : <X className="w-2.5 h-2.5" />}
                      </div>
                      <span>{row.genericBot.text}</span>
                    </div>
                  </td>

                </tr>
              ))}
            </tbody>

          </table>
        </div>

        {/* Bottom Callout Banner */}
        <div className="mt-8 p-6 bg-gradient-to-r from-ember/15 via-carbon-surface to-carbon-surface border border-ember/30 rounded-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded bg-ember text-white">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <div className="font-ancha text-xs uppercase font-bold text-bone">Tus clientes se quedan en tu WhatsApp</div>
              <p className="text-xs text-bone-muted mt-0.5">
                No regalás la base de datos de tus comensales ni pagás el 30% de tu esfuerzo a intermediarios.
              </p>
            </div>
          </div>
          <span className="font-ancha text-xs font-bold text-ember uppercase tracking-wider whitespace-nowrap bg-carbon px-3 py-1.5 border border-carbon-border">
            100% CANAL PROPIO
          </span>
        </div>

      </div>
    </section>
  );
};
