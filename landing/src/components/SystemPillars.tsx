import React, { useState } from 'react';
import { PILLARS_DATA } from '../data/comparisonData';
import { Check, Sparkles, Tablet, Receipt, Power, Volume2, ShieldCheck, ArrowRight } from 'lucide-react';

interface SystemPillarsProps {
  onOpenSimulator: () => void;
}

export const SystemPillars: React.FC<SystemPillarsProps> = ({ onOpenSimulator }) => {
  // Interactive mock state for Pillar 02 (Switch "Se Acabó")
  const [burgerStock, setBurgerStock] = useState<boolean>(true);
  const [ribStock, setRibStock] = useState<boolean>(false);

  const toggleStock = (item: 'burger' | 'rib') => {
    if (item === 'burger') {
      const next = !burgerStock;
      setBurgerStock(next);
    } else {
      const next = !ribStock;
      setRibStock(next);
    }
  };

  return (
    <section id="sistema" className="py-24 sm:py-36 bg-carbon relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Header */}
        <div className="max-w-3xl mb-16 sm:mb-24">
          <div className="inline-flex items-center gap-2 font-mono text-xs text-ember uppercase tracking-widest mb-3">
            <span className="w-2 h-2 bg-ember rounded-full" />
            <span>Los Tres Engranajes del Sistema</span>
          </div>
          <h2 className="font-display text-3xl sm:text-5xl lg:text-6xl font-extrabold uppercase text-bone tracking-tightest leading-tight">
            Diseñado para la grasa del mostrador, no para una oficina.
          </h2>
          <p className="mt-4 text-base sm:text-lg text-bone-muted font-sans">
            Tres piezas que trabajan en sintonía perfecta: el bot que atiende y vende, el panel que organiza la cocina y el motor fiscal que factura.
          </p>
        </div>

        {/* Pillars Container with Alternating Layouts */}
        <div className="space-y-28 sm:space-y-40">
          
          {/* =========================================================================
              PILLAR 01: EL AGENTE CONVERSACIONAL (WhatsApp)
             ========================================================================= */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-16 items-center">
            
            {/* Text column (6 cols) */}
            <div className="lg:col-span-6 space-y-6">
              <div className="flex items-center gap-3">
                <span className="font-mono text-4xl sm:text-5xl font-black text-ember">01</span>
                <div className="h-px flex-1 bg-carbon-border" />
                <span className="font-mono text-xs uppercase tracking-widest text-bone-muted/80 bg-carbon-surface px-3 py-1 border border-carbon-border">
                  El Asistente Inteligente
                </span>
              </div>

              <h3 className="font-display text-2xl sm:text-4xl font-bold text-bone uppercase tracking-tight">
                {PILLARS_DATA[0].title}
              </h3>

              <p className="text-base text-bone-muted leading-relaxed font-sans">
                {PILLARS_DATA[0].description}
              </p>

              {/* Bullet list */}
              <div className="space-y-3 pt-2">
                {PILLARS_DATA[0].bulletPoints.map((bp, idx) => (
                  <div key={idx} className="flex items-start gap-3 text-sm text-bone">
                    <div className="mt-1 w-4 h-4 rounded-full bg-ember/15 border border-ember/30 flex items-center justify-center text-ember flex-shrink-0">
                      <Check className="w-2.5 h-2.5" />
                    </div>
                    <span>{bp}</span>
                  </div>
                ))}
              </div>

              {/* Quote box */}
              <div className="p-4 bg-carbon-surface border-l-2 border-ember font-serif text-sm text-bone-muted mt-6">
                "{PILLARS_DATA[0].quote}"
                <span className="block font-sans font-mono text-[10px] text-ember uppercase mt-1 tracking-wider">
                  — {PILLARS_DATA[0].quoteAuthor}
                </span>
              </div>
            </div>

            {/* Visual Column: Realistic Interactive WhatsApp Mockup (6 cols) */}
            <div className="lg:col-span-6 relative">
              <div className="bg-[#0B141A] rounded-xl border border-stone-800 shadow-sm p-4 sm:p-6 text-stone-100 font-sans max-w-lg mx-auto relative overflow-hidden">
                
                {/* Chat Top Bar */}
                <div className="flex items-center justify-between pb-3 border-b border-stone-800 mb-4 font-mono text-xs">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-ember flex items-center justify-center text-white font-bold text-sm">
                      BB
                    </div>
                    <div>
                      <div className="font-bold text-stone-100 flex items-center gap-1.5">
                        <span>Parrilla & Burger Central</span>
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                      </div>
                      <div className="text-[10px] text-emerald-400 font-sans">En línea · Atendiendo con BlendBot</div>
                    </div>
                  </div>
                  <span className="text-[10px] text-stone-400">21:12 hs</span>
                </div>

                {/* Message Thread */}
                <div className="space-y-3 text-xs sm:text-sm">
                  
                  {/* Client Msg 1 */}
                  <div className="flex justify-end">
                    <div className="bg-[#005C4B] text-white p-3 rounded-lg rounded-tr-none max-w-[85%] shadow-sm">
                      <p>Buenas noches! Me mandás 2 dobles con cheddar y unas papas rústicas? A una no le pongas cebolla por favor!</p>
                      <span className="block text-[9px] text-stone-300 text-right mt-1">21:12 hs ✓✓</span>
                    </div>
                  </div>

                  {/* Client Audio Msg */}
                  <div className="flex justify-end">
                    <div className="bg-[#005C4B] text-white p-2.5 rounded-lg rounded-tr-none max-w-[75%] shadow-sm flex items-center gap-3">
                      <div className="w-7 h-7 rounded-full bg-emerald-700 flex items-center justify-center text-white">
                        <Volume2 className="w-3.5 h-3.5" />
                      </div>
                      <div className="flex-1">
                        <div className="h-1 bg-white/30 rounded-full w-full mb-1">
                          <div className="h-full bg-white rounded-full w-2/3" />
                        </div>
                        <div className="flex justify-between text-[9px] text-stone-300 font-mono">
                          <span>0:07</span>
                          <span>"Mandámelo a Gurruchaga 1750"</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Bot Reply */}
                  <div className="flex justify-start">
                    <div className="bg-[#202C33] text-stone-100 p-3.5 rounded-lg rounded-tl-none max-w-[90%] shadow-sm border border-stone-700/60">
                      <div className="flex items-center gap-1.5 text-ember text-[10px] font-mono font-bold uppercase mb-1">
                        <Sparkles className="w-3 h-3" />
                        <span>Comanda Armada en 1.1s</span>
                      </div>
                      <p className="leading-relaxed">
                        ¡Marchando para Gurruchaga 1750! 🍔 <br />
                        • 1x Doble Cheddar clásica<br />
                        • 1x Doble Cheddar <strong className="text-amber-400">SIN CEBOLLA</strong><br />
                        • 1x Papas Rústicas<br />
                        <strong className="text-white font-mono block mt-1">Total: $24.800 (Envío bonificado)</strong>
                      </p>
                      <p className="mt-2 text-stone-300 text-[11px]">
                        ¿Abonás con transferencia (Alias) o efectivo al repartidor?
                      </p>
                      <span className="block text-[9px] text-stone-400 text-right mt-1">21:13 hs</span>
                    </div>
                  </div>

                </div>

                {/* Micro Footer Badge */}
                <div className="mt-4 pt-3 border-t border-stone-800/80 flex items-center justify-between text-[10px] font-mono text-stone-400">
                  <span>CANAL: WHATSAPP CLOUD API OFICIAL</span>
                  <span className="text-emerald-400">0% ERRORES DE COMANDA</span>
                </div>

              </div>
            </div>

          </div>


          {/* =========================================================================
              PILLAR 02: LA TABLET DE COCINA & SWITCH "SE ACABÓ" (Reversed Layout)
             ========================================================================= */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-16 items-center">
            
            {/* Visual Column */}
            <div className="lg:col-span-6 order-2 lg:order-1 relative">
              <div className="bg-carbon-surface rounded-xl border border-carbon-border p-4 sm:p-6 shadow-sm">
                
                {/* Tablet Top Bar */}
                <div className="flex items-center justify-between pb-4 border-b border-carbon-border mb-4 font-mono">
                  <div className="flex items-center gap-2">
                    <Tablet className="w-4 h-4 text-ember" />
                    <span className="text-xs font-bold text-bone uppercase">Panel de Despacho // Vista Cocina</span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-bone-muted">
                    <span className="w-2 h-2 rounded-full bg-gastrono-ready" />
                    <span>TOUCH OPTIMIZADO ≥48PX</span>
                  </div>
                </div>

                {/* Interactive Stock Switch Showcase */}
                <div className="space-y-3">
                  <div className="text-xs font-mono text-bone-muted uppercase tracking-wider mb-2">
                    Control de Disponibilidad Instantánea (Probá tocar el botón):
                  </div>

                  {/* Switch Row 1: Hamburguesa */}
                  <div className={`p-3.5 rounded border transition-all duration-200 flex items-center justify-between ${
                    burgerStock ? 'bg-carbon border-carbon-border' : 'bg-red-950/20 border-ember/40'
                  }`}>
                    <div>
                      <div className="font-mono text-sm font-bold text-bone">Doble Smash Wagyu 180g</div>
                      <div className="text-[11px] font-mono mt-0.5">
                        {burgerStock ? (
                          <span className="text-gastrono-ready font-semibold">● DISPONIBLE EN EL BOT</span>
                        ) : (
                          <span className="text-ember font-bold">✕ SE ACABÓ (El bot ya no lo ofrece)</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => toggleStock('burger')}
                      className={`px-4 py-2.5 rounded font-mono text-xs uppercase font-bold flex items-center gap-2 transition-all active:scale-95 min-h-[48px] ${
                        burgerStock 
                          ? 'bg-gastrono-ready/20 text-emerald-400 border border-emerald-500/40 hover:bg-gastrono-ready hover:text-white' 
                          : 'bg-ember text-white shadow-lg shadow-ember/30'
                      }`}
                    >
                      <Power className="w-3.5 h-3.5" />
                      <span>{burgerStock ? 'Pausar' : 'SE ACABÓ'}</span>
                    </button>
                  </div>

                  {/* Switch Row 2: Ojo de Bife */}
                  <div className={`p-3.5 rounded border transition-all duration-200 flex items-center justify-between ${
                    ribStock ? 'bg-carbon border-carbon-border' : 'bg-red-950/20 border-ember/40'
                  }`}>
                    <div>
                      <div className="font-mono text-sm font-bold text-bone">Ojo de Bife Madurado 600g</div>
                      <div className="text-[11px] font-mono mt-0.5">
                        {ribStock ? (
                          <span className="text-gastrono-ready font-semibold">● DISPONIBLE EN EL BOT</span>
                        ) : (
                          <span className="text-ember font-bold">✕ SE ACABÓ (Ofreciendo Entraña como reemplazo)</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => toggleStock('rib')}
                      className={`px-4 py-2.5 rounded font-mono text-xs uppercase font-bold flex items-center gap-2 transition-all active:scale-95 min-h-[48px] ${
                        ribStock 
                          ? 'bg-gastrono-ready/20 text-emerald-400 border border-emerald-500/40 hover:bg-gastrono-ready hover:text-white' 
                          : 'bg-ember text-white shadow-lg shadow-ember/30'
                      }`}
                    >
                      <Power className="w-3.5 h-3.5" />
                      <span>{ribStock ? 'Pausar' : 'SE ACABÓ'}</span>
                    </button>
                  </div>

                </div>

                {/* Delay Selector */}
                <div className="mt-4 p-3 bg-carbon rounded border border-carbon-border flex items-center justify-between font-mono text-xs">
                  <div>
                    <span className="text-bone-muted">Demora global de cocina:</span>
                    <span className="text-bone font-bold ml-2">20–30 min</span>
                  </div>
                  <span className="text-ember font-semibold">+10 min con 1 toque</span>
                </div>

              </div>
            </div>

            {/* Text Column */}
            <div className="lg:col-span-6 order-1 lg:order-2 space-y-6">
              <div className="flex items-center gap-3">
                <span className="font-mono text-4xl sm:text-5xl font-black text-ember">02</span>
                <div className="h-px flex-1 bg-carbon-border" />
                <span className="font-mono text-xs uppercase tracking-widest text-bone-muted/80 bg-carbon-surface px-3 py-1 border border-carbon-border">
                  El Panel Operativo
                </span>
              </div>

              <h3 className="font-display text-2xl sm:text-4xl font-bold text-bone uppercase tracking-tight">
                {PILLARS_DATA[1].title}
              </h3>

              <p className="text-base text-bone-muted leading-relaxed font-sans">
                {PILLARS_DATA[1].description}
              </p>

              {/* Bullet list */}
              <div className="space-y-3 pt-2">
                {PILLARS_DATA[1].bulletPoints.map((bp, idx) => (
                  <div key={idx} className="flex items-start gap-3 text-sm text-bone">
                    <div className="mt-1 w-4 h-4 rounded-full bg-ember/15 border border-ember/30 flex items-center justify-center text-ember flex-shrink-0">
                      <Check className="w-2.5 h-2.5" />
                    </div>
                    <span>{bp}</span>
                  </div>
                ))}
              </div>

              {/* Quote box */}
              <div className="p-4 bg-carbon-surface border-l-2 border-ember font-serif text-sm text-bone-muted mt-6">
                "{PILLARS_DATA[1].quote}"
                <span className="block font-sans font-mono text-[10px] text-ember uppercase mt-1 tracking-wider">
                  — {PILLARS_DATA[1].quoteAuthor}
                </span>
              </div>
            </div>

          </div>


          {/* =========================================================================
              PILLAR 03: FACTURACIÓN FISCAL ARCA (AFIP)
             ========================================================================= */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-16 items-center">
            
            {/* Text Column (6 cols) */}
            <div className="lg:col-span-6 space-y-6">
              <div className="flex items-center gap-3">
                <span className="font-mono text-4xl sm:text-5xl font-black text-ember">03</span>
                <div className="h-px flex-1 bg-carbon-border" />
                <span className="font-mono text-xs uppercase tracking-widest text-bone-muted/80 bg-carbon-surface px-3 py-1 border border-carbon-border">
                  Normativa Fiscal 2026
                </span>
              </div>

              <h3 className="font-display text-2xl sm:text-4xl font-bold text-bone uppercase tracking-tight">
                {PILLARS_DATA[2].title}
              </h3>

              <p className="text-base text-bone-muted leading-relaxed font-sans">
                {PILLARS_DATA[2].description}
              </p>

              {/* Bullet list */}
              <div className="space-y-3 pt-2">
                {PILLARS_DATA[2].bulletPoints.map((bp, idx) => (
                  <div key={idx} className="flex items-start gap-3 text-sm text-bone">
                    <div className="mt-1 w-4 h-4 rounded-full bg-ember/15 border border-ember/30 flex items-center justify-center text-ember flex-shrink-0">
                      <Check className="w-2.5 h-2.5" />
                    </div>
                    <span>{bp}</span>
                  </div>
                ))}
              </div>

              {/* Interactive trigger */}
              <div className="pt-4">
                <button
                  onClick={() => {
                    onOpenSimulator();
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-carbon-surface hover:bg-carbon-hover border border-ember/40 text-ember font-mono text-xs uppercase tracking-wider transition-colors"
                >
                  <Receipt className="w-4 h-4" />
                  <span>Ver cómo emite la factura en el Simulador</span>
                  <ArrowRight className="w-3.5 h-3.5 ml-1" />
                </button>
              </div>
            </div>

            {/* Visual Column: Authentic Thermal Ticket with ARCA CAE (6 cols) */}
            <div className="lg:col-span-6 relative">
              <div className="max-w-md mx-auto bg-ticket-paper text-ticket-ink font-mono p-6 sm:p-8 rounded-sm shadow-sm relative">
                
                {/* Serrated edge styling */}
                <div className="text-center border-b-2 border-dashed border-ticket-ink/30 pb-4 mb-4">
                  <div className="font-bold text-base sm:text-lg tracking-tight uppercase">
                    BLEND GASTRONOMIA S.R.L.
                  </div>
                  <div className="text-xs text-stone-600 mt-0.5">
                    CUIT: 30-71849201-9 · IIBB: 1420912-04
                  </div>
                  <div className="text-[11px] text-stone-500">
                    Av. Coronel Díaz 1450, Palermo, CABA
                  </div>
                  <div className="mt-2 inline-block px-3 py-0.5 bg-black text-white text-[11px] font-black uppercase">
                    FACTURA ELECTRÓNICA "B"
                  </div>
                </div>

                {/* Order Breakdown */}
                <div className="text-xs space-y-1.5 border-b-2 border-dashed border-ticket-ink/30 pb-4 mb-4">
                  <div className="flex justify-between font-bold">
                    <span>CANT / DESCRIPCIÓN</span>
                    <span>IMPORTE</span>
                  </div>
                  <div className="flex justify-between">
                    <span>2x DOBLE SMASH ASADO</span>
                    <span>$19.600,00</span>
                  </div>
                  <div className="flex justify-between text-[11px] text-stone-600 pl-2">
                    <span>• 1x Completa / 1x Sin Cebolla</span>
                    <span></span>
                  </div>
                  <div className="flex justify-between">
                    <span>1x PAPAS TRUFADAS</span>
                    <span>$5.800,00</span>
                  </div>
                  <div className="flex justify-between">
                    <span>1x ENVÍO PALERMO</span>
                    <span>$3.000,00</span>
                  </div>
                </div>

                {/* Total */}
                <div className="space-y-1 text-xs border-b-2 border-dashed border-ticket-ink/30 pb-4 mb-4">
                  <div className="flex justify-between text-base font-black">
                    <span>TOTAL FACTURADO:</span>
                    <span className="text-ember">$28.400,00</span>
                  </div>
                  <div className="flex justify-between text-[10px] text-stone-500">
                    <span>IVA Incluido (21%):</span>
                    <span>$4.928,92</span>
                  </div>
                </div>

                {/* Official ARCA CAE Box */}
                <div className="bg-stone-100 p-3 border border-stone-300 rounded text-[11px] space-y-1">
                  <div className="flex justify-between items-center text-ticket-stamp font-bold">
                    <span>AUTORIZADO POR ARCA (AFIP)</span>
                    <span className="w-2 h-2 bg-emerald-600 rounded-full" />
                  </div>
                  <div className="flex justify-between">
                    <span className="font-semibold">CAE N°:</span>
                    <span className="font-bold tracking-wider">74391829304859</span>
                  </div>
                  <div className="flex justify-between text-stone-600">
                    <span>Vto. CAE:</span>
                    <span>31/08/2026</span>
                  </div>
                  <div className="flex justify-between text-stone-600">
                    <span>Pto. Venta / Comp:</span>
                    <span>0004 - 00008492</span>
                  </div>
                </div>

                {/* Stamp overlay */}
                <div className="absolute top-1/2 right-6 stamp-arca px-3 py-1 text-xs font-bold bg-ticket-paper/90 shadow-md">
                  CAE VALIDADO
                </div>

              </div>
            </div>

          </div>

        </div>

      </div>
    </section>
  );
};
