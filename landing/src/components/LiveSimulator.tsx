import React, { useState, useEffect } from 'react';
import { SIMULATION_SCENARIOS, SimulationScenario } from '../data/simulationData';
import { MessageSquare, Tablet, Receipt, Sparkles, ShieldCheck, RefreshCw, Power } from 'lucide-react';
import confetti from 'canvas-confetti';

export const LiveSimulator: React.FC = () => {
  const [activeScenarioIndex, setActiveScenarioIndex] = useState<number>(0);
  const [chatStep, setChatStep] = useState<'idle' | 'typing' | 'replied'>('idle');
  const [tabletStatus, setTabletStatus] = useState<'pendiente' | 'en-marcha' | 'listo' | 'cobrado'>('pendiente');
  const [stockSwitchState, setStockSwitchState] = useState<boolean>(false);

  const currentScenario: SimulationScenario = SIMULATION_SCENARIOS[activeScenarioIndex];

  // Load scenario
  const selectScenario = (index: number) => {
    setActiveScenarioIndex(index);
    setChatStep('idle');
    setTabletStatus('pendiente');
    setStockSwitchState(false);
  };

  // Run scenario simulation
  const handleTriggerMessage = () => {
    setChatStep('typing');
    setTabletStatus('pendiente');

    setTimeout(() => {
      setChatStep('replied');
      setTabletStatus('en-marcha');
    }, 1200);
  };

  // Kitchen tablet advance status
  const handleAdvanceTabletStatus = () => {
    if (tabletStatus === 'pendiente') {
      setTabletStatus('en-marcha');
    } else if (tabletStatus === 'en-marcha') {
      setTabletStatus('listo');
    } else if (tabletStatus === 'listo') {
      setTabletStatus('cobrado');
      try {
        confetti({
          particleCount: 40,
          spread: 60,
          origin: { y: 0.75 },
          colors: ['#E04622', '#F5EFEB', '#EAC875']
        });
      } catch {
        // Silently catch
      }
    }
  };

  // Toggle "Se Acabó" in simulator
  const handleToggleStock = () => {
    const next = !stockSwitchState;
    setStockSwitchState(next);
  };

  useEffect(() => {
    // Automatically trigger preview for initial scenario
    setChatStep('replied');
    setTabletStatus('en-marcha');
  }, [activeScenarioIndex]);

  return (
    <section id="simulador" className="py-24 sm:py-36 bg-carbon-deep border-y border-carbon-border relative overflow-hidden">
      
      {/* Background ambient lighting */}
      <div className="absolute top-10 left-1/3 w-[600px] h-[600px] bg-ember/5 rounded-full blur-[150px] pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-12">
          <div>
            <div className="inline-flex items-center gap-2 font-mono text-xs text-ember uppercase tracking-widest mb-2">
              <Sparkles className="w-4 h-4" />
              <span>Simulador Interactivo en Tiempo Real</span>
            </div>
            <h2 className="font-display text-3xl sm:text-5xl font-extrabold uppercase text-bone tracking-tightest">
              Mirá el circuito cerrado en vivo.
            </h2>
            <p className="mt-2 text-bone-muted font-sans max-w-2xl text-sm sm:text-base">
              Elegí un escenario real de un viernes a la noche y mirá cómo interactúan el WhatsApp del cliente, la tablet del despacho y el comprobante fiscal con CAE.
            </p>
          </div>

          {/* Scenario Selector Pills */}
          <div className="flex flex-wrap gap-2 font-mono text-xs">
            {SIMULATION_SCENARIOS.map((sc, idx) => (
              <button
                key={sc.id}
                onClick={() => selectScenario(idx)}
                className={`px-3.5 py-2 rounded-sm border transition-all active:scale-95 flex items-center gap-2 ${
                  activeScenarioIndex === idx
                    ? 'bg-ember text-white border-ember shadow-lg shadow-ember/25 font-bold'
                    : 'bg-carbon-surface text-bone-muted border-carbon-border hover:border-bone-muted/40 hover:text-bone'
                }`}
              >
                <span>0{idx + 1}</span>
                <span>{sc.title}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 3-Column Split-Screen Simulator */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
          
          {/* =========================================================================
              COLUMN 1: EL CLIENTE EN WHATSAPP (4 cols)
             ========================================================================= */}
          <div className="lg:col-span-4 bg-[#0C1317] rounded-lg border border-stone-800 p-4 sm:p-5 shadow-sm flex flex-col justify-between h-full min-h-[520px]">
            <div>
              
              {/* WhatsApp Header */}
              <div className="flex items-center justify-between pb-3 border-b border-stone-800 font-mono text-xs">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center text-white font-bold">
                    <MessageSquare className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-stone-100 font-bold font-sans text-xs flex items-center gap-1">
                      <span>Restaurante Blend</span>
                      <ShieldCheck className="w-3 h-3 text-emerald-400" />
                    </div>
                    <div className="text-[10px] text-emerald-400 font-mono">IA BlendBot Activa</div>
                  </div>
                </div>
                <span className="text-[10px] text-stone-500">{currentScenario.badge}</span>
              </div>

              {/* Chat Thread */}
              <div className="mt-4 space-y-3 font-sans text-xs">
                
                {/* Client incoming message */}
                <div className="flex justify-end">
                  <div className="bg-[#005C4B] text-white p-3 rounded-lg rounded-tr-none max-w-[90%] shadow">
                    <p className="leading-relaxed">{currentScenario.clientMessage}</p>
                    <span className="block text-[9px] text-stone-300 text-right mt-1 font-mono">21:14 hs ✓✓</span>
                  </div>
                </div>

                {/* Bot typing or reply */}
                {chatStep === 'typing' ? (
                  <div className="flex justify-start">
                    <div className="bg-[#202C33] text-stone-300 px-4 py-2.5 rounded-lg rounded-tl-none font-mono text-xs flex items-center gap-2">
                      <span className="inline-block w-2 h-2 bg-ember rounded-full animate-bounce" />
                      <span className="inline-block w-2 h-2 bg-ember rounded-full animate-bounce [animation-delay:0.2s]" />
                      <span className="inline-block w-2 h-2 bg-ember rounded-full animate-bounce [animation-delay:0.4s]" />
                      <span className="text-[10px] text-stone-400 ml-1">BlendBot analizando pedido...</span>
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-start animate-fadeIn">
                    <div className="bg-[#202C33] text-stone-100 p-3.5 rounded-lg rounded-tl-none max-w-[95%] shadow border border-stone-700/60">
                      <div className="flex items-center gap-1.5 text-ember text-[10px] font-mono font-bold uppercase mb-1.5">
                        <Sparkles className="w-3 h-3" />
                        <span>Respuesta en 1.2 seg</span>
                      </div>
                      <p className="leading-relaxed whitespace-pre-line text-stone-200">
                        {currentScenario.botReply}
                      </p>
                      <span className="block text-[9px] text-stone-400 text-right mt-2 font-mono">21:14 hs</span>
                    </div>
                  </div>
                )}

              </div>
            </div>

            {/* Bottom Actions for WhatsApp Simulation */}
            <div className="mt-4 pt-3 border-t border-stone-800 space-y-2">
              <button
                onClick={handleTriggerMessage}
                className="w-full py-2.5 px-3 bg-stone-800 hover:bg-stone-700 text-stone-200 rounded font-mono text-xs uppercase flex items-center justify-center gap-2 transition-colors active:scale-98"
              >
                <RefreshCw className="w-3.5 h-3.5 text-ember" />
                <span>Re-ejecutar mensaje del cliente</span>
              </button>
            </div>

          </div>


          {/* =========================================================================
              COLUMN 2: LA TABLET EN LA COCINA (4 cols)
             ========================================================================= */}
          <div className="lg:col-span-4 bg-carbon-surface rounded-lg border border-carbon-border p-4 sm:p-5 shadow-sm flex flex-col justify-between h-full min-h-[520px]">
            <div>
              
              {/* Tablet Header */}
              <div className="flex items-center justify-between pb-3 border-b border-carbon-border font-mono text-xs">
                <div className="flex items-center gap-2">
                  <Tablet className="w-4 h-4 text-ember" />
                  <span className="font-bold text-bone uppercase">Tablet Cocina // Despacho</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-gastrono-live" />
                  <span className="text-[10px] text-bone-muted">MESA DE TRABAJO</span>
                </div>
              </div>

              {/* Ticket View */}
              <div className="mt-4 bg-carbon p-4 rounded border border-carbon-border space-y-3 font-mono">
                
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-bone">{currentScenario.order.id}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                    tabletStatus === 'pendiente' ? 'bg-amber-950/60 text-amber-400 border border-amber-500/30' :
                    tabletStatus === 'en-marcha' ? 'bg-blue-950/60 text-blue-400 border border-blue-500/30' :
                    tabletStatus === 'listo' ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-500/30' :
                    'bg-stone-800 text-stone-300'
                  }`}>
                    {tabletStatus === 'pendiente' && '⏳ PENDIENTE'}
                    {tabletStatus === 'en-marcha' && '🔥 MARCHANDO'}
                    {tabletStatus === 'listo' && '✅ LISTO PARA COBRAR'}
                    {tabletStatus === 'cobrado' && '💵 COBRADO & FACTURADO'}
                  </span>
                </div>

                <div className="text-xs text-bone-muted">
                  <div className="text-bone font-semibold">{currentScenario.order.clientName}</div>
                  <div className="text-[11px] text-bone-muted/80">{currentScenario.order.tableOrChannel} · {currentScenario.order.time}</div>
                </div>

                {/* Items List */}
                <div className="space-y-1.5 border-t border-carbon-border pt-2 text-xs">
                  {currentScenario.order.items.map((it, idx) => (
                    <div key={idx} className="flex justify-between items-start">
                      <div>
                        <span className="text-bone font-bold">{it.quantity}x {it.name}</span>
                        {it.notes && (
                          <div className="text-[10px] text-ember font-semibold">{it.notes}</div>
                        )}
                      </div>
                      <span className="text-bone-muted text-[11px]">
                        {it.price > 0 ? `$${it.price.toLocaleString('es-AR')}` : 'Incluido'}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Total */}
                <div className="border-t border-carbon-border pt-2 flex justify-between items-center text-sm font-bold">
                  <span className="text-bone-muted uppercase text-xs">Total Comanda:</span>
                  <span className="text-ember text-base font-black">
                    {currentScenario.order.total > 0 ? `$${currentScenario.order.total.toLocaleString('es-AR')}` : 'Reserva Confirmada'}
                  </span>
                </div>

              </div>

              {/* Stock Switch Showcase */}
              <div className="mt-4 p-3 bg-carbon rounded border border-carbon-border text-xs font-mono">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-bold text-bone">Switch "SE ACABÓ":</div>
                    <div className="text-[10px] text-bone-muted">
                      {stockSwitchState ? 'Plato pausado en el bot' : 'Plato disponible'}
                    </div>
                  </div>
                  <button
                    onClick={handleToggleStock}
                    className={`px-3 py-1.5 rounded font-bold text-[11px] uppercase transition-all flex items-center gap-1.5 ${
                      stockSwitchState
                        ? 'bg-ember text-white shadow-md'
                        : 'bg-carbon-surface text-stone-400 border border-carbon-border hover:text-bone'
                    }`}
                  >
                    <Power className="w-3 h-3" />
                    <span>{stockSwitchState ? 'SE ACABÓ (ON)' : 'DISPONIBLE'}</span>
                  </button>
                </div>
              </div>

            </div>

            {/* Advance Status Button */}
            <div className="mt-4 pt-3 border-t border-carbon-border">
              <button
                onClick={handleAdvanceTabletStatus}
                className="w-full py-3 px-4 bg-ember hover:bg-ember-glow text-white font-mono text-xs uppercase font-bold tracking-wider rounded-sm transition-all active:scale-98 flex items-center justify-center gap-2 shadow-lg shadow-ember/20"
              >
                {tabletStatus === 'pendiente' && <span>Marchando a Cocina →</span>}
                {tabletStatus === 'en-marcha' && <span>Marcar Plato Listo →</span>}
                {tabletStatus === 'listo' && <span>Cobrar y Emitir ARCA ⚡</span>}
                {tabletStatus === 'cobrado' && <span>Factura Emitida ✓ (Volver a cobrar)</span>}
              </button>
            </div>

          </div>


          {/* =========================================================================
              COLUMN 3: LA FACTURA FISCAL ARCA (4 cols)
             ========================================================================= */}
          <div className="lg:col-span-4 bg-ticket-paper text-ticket-ink rounded-lg border border-stone-300 p-4 sm:p-5 shadow-sm flex flex-col justify-between h-full min-h-[520px] font-mono relative overflow-hidden">
            
            {/* Top Bar */}
            <div>
              <div className="text-center border-b border-dashed border-stone-400 pb-3 mb-3">
                <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-ticket-stamp uppercase">
                  <Receipt className="w-4 h-4" />
                  <span>Emisión Fiscal Automática</span>
                </div>
                <div className="text-[10px] text-stone-500 mt-0.5">
                  Sidecar Oficial ARCA // WebService Homologado
                </div>
              </div>

              {/* Fiscal Receipt Content */}
              <div className="space-y-2.5 text-xs">
                
                <div className="text-center">
                  <div className="font-bold text-sm uppercase">{currentScenario.invoice.razonSocial}</div>
                  <div className="text-[11px] text-stone-600">CUIT: {currentScenario.invoice.cuitEmisor}</div>
                  <div className="text-[10px] text-stone-500">Punto de Venta: {currentScenario.invoice.ptoVta} · Comp: {currentScenario.invoice.cbteNro}</div>
                  <div className="text-[10px] text-stone-500">Fecha: {currentScenario.invoice.fecha}</div>
                </div>

                <div className="border-t border-b border-dashed border-stone-400 py-2 space-y-1">
                  <div className="flex justify-between font-bold text-xs">
                    <span>IMPORTE TOTAL:</span>
                    <span className="text-ember font-black">
                      ${currentScenario.invoice.importeTotal.toLocaleString('es-AR')},00
                    </span>
                  </div>
                  {currentScenario.invoice.ivaTotal > 0 && (
                    <div className="flex justify-between text-[10px] text-stone-600">
                      <span>IVA Discriminado:</span>
                      <span>${currentScenario.invoice.ivaTotal.toLocaleString('es-AR')}</span>
                    </div>
                  )}
                </div>

                {/* CAE & Official Stamp */}
                <div className="bg-stone-200/70 p-2.5 rounded border border-stone-300 space-y-1 text-[11px]">
                  <div className="flex justify-between items-center text-emerald-800 font-bold">
                    <span>CAE APROBADO:</span>
                    <span className="w-2 h-2 rounded-full bg-emerald-600" />
                  </div>
                  <div className="font-bold text-xs tracking-wider text-ticket-stamp">
                    {currentScenario.invoice.cae}
                  </div>
                  <div className="text-[10px] text-stone-600 flex justify-between">
                    <span>Vencimiento:</span>
                    <span>{currentScenario.invoice.caeVto}</span>
                  </div>
                </div>

                {/* QR Code Simulation */}
                <div className="pt-2 flex items-center gap-3">
                  <div className="w-14 h-14 bg-white border border-stone-300 p-1 rounded flex items-center justify-center flex-shrink-0">
                    <div className="w-full h-full bg-stone-900 grid grid-cols-4 gap-0.5 p-0.5">
                      <div className="bg-white col-span-2 row-span-2" />
                      <div className="bg-white col-span-1" />
                      <div className="bg-white col-span-1" />
                      <div className="bg-white col-span-2" />
                      <div className="bg-white col-span-1" />
                      <div className="bg-white col-span-1" />
                    </div>
                  </div>
                  <div className="text-[10px] text-stone-600 leading-tight">
                    Comprobante fiscal con código QR oficial AFIP / ARCA según R.G. 4291/2018.
                  </div>
                </div>

              </div>
            </div>

            {/* Bottom Status */}
            <div className="mt-4 pt-3 border-t border-dashed border-stone-400 flex items-center justify-between text-[10px] font-bold text-ticket-stamp">
              <span>TIEMPO EMISIÓN: 840ms</span>
              <span className="text-emerald-700">100% HOMOLOGADO</span>
            </div>

          </div>

        </div>

      </div>
    </section>
  );
};
