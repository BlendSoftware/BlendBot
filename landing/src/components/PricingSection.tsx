import React from 'react';
import { Check, Sparkles, Shield, ArrowUpRight } from 'lucide-react';

interface PricingSectionProps {
  onOpenDemo: () => void;
}

export const PricingSection: React.FC<PricingSectionProps> = ({ onOpenDemo }) => {
  return (
    <section id="precios" className="py-24 sm:py-36 bg-carbon-deep border-y border-carbon-border relative overflow-hidden">
      
      {/* Subtle Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[500px] bg-ember/5 rounded-full blur-[160px] pointer-events-none" />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 font-ancha text-xs text-ember uppercase tracking-widest mb-3">
            <Sparkles className="w-4 h-4" />
            <span>Precios Transparentes // Cero Letra Chica</span>
          </div>
          <h2 className="font-display text-3xl sm:text-5xl font-extrabold uppercase text-bone tracking-tightest leading-tight">
            Un solo plan en pesos. <br />
            <span className="text-ember font-serif font-normal">Cero comisiones sobre tus platos.</span>
          </h2>
          <p className="mt-4 text-base text-bone-muted font-sans">
            La plata de tu cocina es tuya. No te cobramos el 25% ni te obligamos a pagar por cada comanda.
          </p>
        </div>

        {/* Pricing Card (Editorial Monumental Poster) */}
        <div className="max-w-3xl mx-auto bg-carbon-surface border-2 border-ember/60 rounded-sm p-8 sm:p-12 shadow-sm relative">
          
          {/* Top Stamp */}
          <div className="absolute -top-4 right-8 bg-ember text-white px-4 py-1 font-ancha text-xs font-bold uppercase tracking-wider shadow-lg">
            PILOTO 2 MESES BONIFICADO
          </div>

          <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-4 border-b border-carbon-border pb-8 mb-8">
            <div>
              <span className="font-ancha text-xs text-ember uppercase font-bold tracking-widest block mb-1">
                PLAN ÚNICO INTEGRAL
              </span>
              <h3 className="font-display text-2xl sm:text-3xl font-extrabold uppercase text-bone">
                Copiloto Gastronómico Full
              </h3>
              <p className="text-xs text-bone-muted font-sans mt-1">
                Para pizzerías, hamburgueserías, cafés, bares y restaurantes de autor.
              </p>
            </div>

            <div className="text-left sm:text-right">
              <div className="flex items-baseline gap-1">
                <span className="font-display font-black text-4xl sm:text-5xl text-bone tracking-tight">
                  $79.000
                </span>
                <span className="font-ancha text-xs text-bone-muted uppercase">
                  ARS / mes
                </span>
              </div>
              <span className="text-[11px] font-ancha text-gastrono-live font-semibold block mt-1">
                + IVA · 0% comisión x comanda
              </span>
            </div>
          </div>

          {/* Features Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 font-sans text-xs sm:text-sm text-bone mb-8">
            
            <div className="flex items-start gap-3">
              <div className="w-4 h-4 rounded-full bg-ember/20 text-ember flex items-center justify-center flex-shrink-0 mt-0.5">
                <Check className="w-2.5 h-2.5" />
              </div>
              <span><strong>WhatsApp Inteligente Oficial 24/7</strong> (atiende pedidos, reservas y audios)</span>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-4 h-4 rounded-full bg-ember/20 text-ember flex items-center justify-center flex-shrink-0 mt-0.5">
                <Check className="w-2.5 h-2.5" />
              </div>
              <span><strong>Panel de Despacho Táctil Ilimitado</strong> (cocina, barra, mostrador)</span>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-4 h-4 rounded-full bg-ember/20 text-ember flex items-center justify-center flex-shrink-0 mt-0.5">
                <Check className="w-2.5 h-2.5" />
              </div>
              <span><strong>Switch "SE ACABÓ" en 1 segundo</strong> (control de stock en tiempo real)</span>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-4 h-4 rounded-full bg-ember/20 text-ember flex items-center justify-center flex-shrink-0 mt-0.5">
                <Check className="w-2.5 h-2.5" />
              </div>
              <span><strong>Facturación Fiscal Automática ARCA</strong> (con CAE homologado y QR)</span>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-4 h-4 rounded-full bg-ember/20 text-ember flex items-center justify-center flex-shrink-0 mt-0.5">
                <Check className="w-2.5 h-2.5" />
              </div>
              <span><strong>Puesta en marcha en 48hs</strong> con carga completa de tu carta</span>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-4 h-4 rounded-full bg-ember/20 text-ember flex items-center justify-center flex-shrink-0 mt-0.5">
                <Check className="w-2.5 h-2.5" />
              </div>
              <span><strong>Soporte gastronómico directo</strong> los viernes y fines de semana</span>
            </div>

          </div>

          {/* Pilot CTA Action */}
          <div className="space-y-3">
            <button
              onClick={() => {
                onOpenDemo();
              }}
              className="w-full py-4 bg-ember hover:bg-ember-glow text-white font-ancha text-xs sm:text-sm uppercase font-bold tracking-wider flex items-center justify-center gap-2 transition-all active:scale-98 shadow-sm shadow-ember/25"
            >
              <span>Solicitar Prueba Piloto Sin Cargo (2 Meses)</span>
              <ArrowUpRight className="w-4 h-4" />
            </button>
            <div className="flex items-center justify-center gap-2 font-ancha text-[11px] text-bone-muted/70">
              <Shield className="w-3.5 h-3.5 text-gastrono-ready" />
              <span>Sin permanencia mínima · Cancelás cuando quieras con 1 click</span>
            </div>
          </div>

        </div>

      </div>
    </section>
  );
};
