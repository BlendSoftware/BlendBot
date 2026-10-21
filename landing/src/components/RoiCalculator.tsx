import React, { useState } from 'react';
import { Calculator, ArrowUpRight } from 'lucide-react';

interface RoiCalculatorProps {
  onOpenDemo: () => void;
}

export const RoiCalculator: React.FC<RoiCalculatorProps> = ({ onOpenDemo }) => {
  const [ticketAvg, setTicketAvg] = useState<number>(18000);
  const [lostOrdersPerWeekend, setLostOrdersPerWeekend] = useState<number>(14);

  // Calculations
  const monthlyLostOrders = lostOrdersPerWeekend * 4;
  const recoveredSalesMonthly = monthlyLostOrders * ticketAvg;
  const deliveryCommissionSaved = Math.round(recoveredSalesMonthly * 0.28);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>, setter: (val: number) => void) => {
    setter(Number(e.target.value));
  };

  return (
    <section className="py-24 sm:py-36 bg-carbon-deep border-y border-carbon-border relative">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 font-ancha text-xs text-ember uppercase tracking-widest mb-3">
            <Calculator className="w-4 h-4" />
            <span>Calculadora de Ventas Recuperadas</span>
          </div>
          <h2 className="font-display text-3xl sm:text-5xl font-extrabold uppercase text-bone tracking-tightest leading-tight">
            ¿Cuánta plata dejás sobre la mesa cada fin de semana?
          </h2>
          <p className="mt-4 text-base text-bone-muted font-sans">
            Deslizá los valores de tu local y calculá cuánto facturás de más respondiendo en 2 segundos y migrando pedidos a tu canal propio.
          </p>
        </div>

        {/* Calculator Main Box */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 bg-carbon-surface border border-carbon-border rounded-sm p-6 sm:p-10 shadow-sm items-center">
          
          {/* Left: Interactive Controls (7 cols) */}
          <div className="lg:col-span-7 space-y-8">
            
            {/* Slider 1: Ticket Promedio */}
            <div className="space-y-3">
              <div className="flex justify-between items-center font-ancha">
                <label className="text-xs uppercase text-bone font-bold tracking-wider">
                  Ticket Promedio de tu Local:
                </label>
                <span className="text-base sm:text-lg font-bold text-ember">
                  ${ticketAvg.toLocaleString('es-AR')} ARS
                </span>
              </div>
              <input 
                type="range" 
                min="8000" 
                max="45000" 
                step="1000" 
                value={ticketAvg}
                onChange={(e) => handleSliderChange(e, setTicketAvg)}
                className="w-full h-2 bg-carbon rounded-lg appearance-none cursor-pointer accent-ember"
              />
              <div className="flex justify-between text-[10px] font-ancha text-bone-muted/60">
                <span>$8.000 (Café/Sandwich)</span>
                <span>$25.000 (Burger/Parrilla)</span>
                <span>$45.000 (Restaurante Autor)</span>
              </div>
            </div>

            {/* Slider 2: Pedidos perdidos por fin de semana */}
            <div className="space-y-3">
              <div className="flex justify-between items-center font-ancha">
                <label className="text-xs uppercase text-bone font-bold tracking-wider">
                  Consultas perdidas por demora x fin de semana:
                </label>
                <span className="text-base sm:text-lg font-bold text-ember">
                  {lostOrdersPerWeekend} pedidos / finde
                </span>
              </div>
              <input 
                type="range" 
                min="4" 
                max="50" 
                step="2" 
                value={lostOrdersPerWeekend}
                onChange={(e) => handleSliderChange(e, setLostOrdersPerWeekend)}
                className="w-full h-2 bg-carbon rounded-lg appearance-none cursor-pointer accent-ember"
              />
              <div className="flex justify-between text-[10px] font-ancha text-bone-muted/60">
                <span>4 pedidos</span>
                <span>25 pedidos (Pico viernes y sábado)</span>
                <span>50 pedidos</span>
              </div>
            </div>

            <div className="p-4 bg-carbon rounded border border-carbon-border text-xs text-bone-muted leading-relaxed font-sans">
              💡 <strong className="text-bone">Dato real de gastronomía:</strong> Un local con 14 pedidos recuperados por fin de semana suma <strong className="text-white font-ancha">{monthlyLostOrders} ventas netas al mes</strong> que hoy se van a la competencia por no contestar en los primeros 3 minutos.
            </div>

          </div>

          {/* Right: Revenue Output Poster (5 cols) */}
          <div className="lg:col-span-5 bg-gradient-to-br from-ember/20 via-carbon to-carbon border-2 border-ember/50 p-6 sm:p-8 rounded shadow-sm relative flex flex-col justify-between">
            
            <div>
              <div className="flex items-center justify-between border-b border-carbon-border pb-3 mb-4 font-ancha text-xs text-bone-muted">
                <span className="uppercase tracking-widest text-ember font-bold">RECUPERACIÓN ESTIMADA</span>
                <span>MENSUAL</span>
              </div>

              <div className="space-y-1">
                <span className="font-ancha text-xs text-bone-muted uppercase">Facturación Extra Directa:</span>
                <div className="font-display font-extrabold text-3xl sm:text-4xl text-bone tracking-tight leading-none">
                  +${recoveredSalesMonthly.toLocaleString('es-AR')}
                  <span className="text-xs font-ancha text-bone-muted ml-1">ARS/mes</span>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-carbon-border/70 space-y-2 text-xs font-ancha text-bone-muted">
                <div className="flex justify-between">
                  <span>Ventas recuperadas:</span>
                  <span className="text-bone font-bold">{monthlyLostOrders} pedidos/mes</span>
                </div>
                <div className="flex justify-between">
                  <span>Ahorro comisiones apps (28%):</span>
                  <span className="text-gastrono-live font-bold">+${deliveryCommissionSaved.toLocaleString('es-AR')}</span>
                </div>
              </div>
            </div>

            <div className="mt-8 pt-4 border-t border-carbon-border">
              <button
                onClick={() => {
                  onOpenDemo();
                }}
                className="w-full py-3.5 bg-ember hover:bg-ember-glow text-white font-ancha text-xs uppercase font-bold tracking-wider flex items-center justify-center gap-2 transition-all active:scale-95 shadow-lg shadow-ember/30"
              >
                <span>Recuperar estas ventas hoy</span>
                <ArrowUpRight className="w-4 h-4" />
              </button>
              <div className="text-[10px] font-ancha text-bone-muted/60 text-center mt-2">
                BlendBot se amortiza solo en tu primer viernes de servicio
              </div>
            </div>

          </div>

        </div>

      </div>
    </section>
  );
};
