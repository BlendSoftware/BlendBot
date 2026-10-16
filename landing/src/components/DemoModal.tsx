import React, { useEffect, useState } from 'react';
import { X, Check, CheckCircle, ChevronDown, MessageSquare, ShieldCheck, ArrowRight } from 'lucide-react';
import confetti from 'canvas-confetti';

interface DemoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const incluye = [
  { titulo: 'WhatsApp que atiende solo', detalle: 'Responde, toma pedidos y reservas 24/7 con tu carta real.' },
  { titulo: 'Comandera de cocina', detalle: 'Los pedidos entran ordenados y pausás platos sin stock con un toque.' },
  { titulo: 'Facturación ARCA', detalle: 'Factura electrónica emitida al cobrar, sin cargar nada a mano.' },
  { titulo: 'Puesta en marcha incluida', detalle: 'Cargamos tu carta y dejamos todo funcionando en 48 hs.' },
];

const pasos = [
  'Te escribimos por WhatsApp en menos de 2 horas.',
  'Armamos la demo con tu carta y tu forma de trabajar.',
  'Instalamos y dejamos todo andando en 48 hs.',
];

const inputClass =
  'w-full bg-paper-pure border border-paper-border hover:border-bone-faint focus:border-terracota focus:ring-2 focus:ring-terracota/15 px-3.5 py-3 text-sm text-tinta placeholder:text-bone-faint outline-none transition-colors rounded-md min-h-[46px]';

const labelClass = 'block text-sm font-medium text-tinta mb-1.5';

export const DemoModal: React.FC<DemoModalProps> = ({ isOpen, onClose }) => {
  const [contactName, setContactName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [vertical, setVertical] = useState('restaurante');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [city, setCity] = useState('ciudad');
  const [notes, setNotes] = useState('');
  const [isSubmitted, setIsSubmitted] = useState(false);

  // Escape cierra y la página de atrás no scrollea mientras el modal está abierto
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitted(true);

    try {
      confetti({
        particleCount: 40,
        spread: 60,
        origin: { y: 0.6 },
        colors: ['#73ABB5', '#CFB23A', '#B78801']
      });
    } catch {
      // Silently catch
    }
  };

  function handleClose() {
    setIsSubmitted(false);
    onClose();
  }

  const openDirectWhatsApp = () => {
    const msg = encodeURIComponent(`Hola! Quiero solicitar el equipamiento completo de BlendBot para mi restaurante/bodega en Mendoza: ${businessName || 'mi local'}.`);
    window.open(`https://wa.me/5492610000000?text=${msg}`, '_blank');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6 bg-tinta/60 backdrop-blur-sm animate-fadeIn"
      onClick={handleClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="demo-modal-title"
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-4xl bg-paper-pure text-tinta border border-paper-border shadow-2xl font-sans rounded-t-xl sm:rounded-xl max-h-[94vh] overflow-y-auto md:overflow-hidden md:grid md:grid-cols-5"
      >

        {/* Close Button (Easy Tap Target) */}
        <button
          onClick={handleClose}
          className="absolute top-3 right-3 sm:top-4 sm:right-4 z-10 p-2.5 text-tinta-muted hover:text-tinta hover:bg-dark-deep rounded-md transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
          aria-label="Cerrar"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Columna de valor: qué incluye la prueba piloto */}
        <aside className="hidden md:flex md:col-span-2 flex-col justify-between gap-8 p-8 bg-terracota-pale border-r border-paper-border relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-brand" aria-hidden="true" />

          <div className="space-y-6">
            <div className="flex items-center gap-2.5">
              <img src="/logo-blend-mark.svg" alt="" className="w-8 h-8 object-contain" />
              <span className="font-display font-bold text-lg tracking-tight">BlendBot</span>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-terracota mb-3">
                Qué incluye la prueba piloto
              </p>
              <ul className="space-y-4">
                {incluye.map((item) => (
                  <li key={item.titulo} className="flex gap-3">
                    <span className="mt-0.5 w-5 h-5 rounded-full bg-terracota text-white flex items-center justify-center flex-shrink-0">
                      <Check className="w-3 h-3" strokeWidth={3} />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-tinta leading-snug">{item.titulo}</p>
                      <p className="text-[13px] text-tinta-muted leading-snug mt-0.5">{item.detalle}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="rounded-lg bg-paper-pure/70 border border-paper-border p-4">
            <p className="text-sm font-semibold text-tinta">Prueba piloto de 2 meses</p>
            <p className="text-[13px] text-tinta-muted leading-snug mt-1">
              Sin permanencia mínima y con 0% de comisión por pedido: tu facturación es toda tuya.
            </p>
          </div>
        </aside>

        {/* Columna del formulario */}
        <div className="md:col-span-3 p-6 sm:p-8 md:max-h-[94vh] md:overflow-y-auto">
          {isSubmitted ? (
            <div className="py-6 sm:py-10 space-y-6">
              <div className="w-12 h-12 bg-terracota-pale text-terracota rounded-full flex items-center justify-center">
                <CheckCircle className="w-6 h-6" />
              </div>
              <div className="space-y-2">
                <h3 id="demo-modal-title" className="font-display font-bold text-2xl sm:text-3xl tracking-tight text-tinta">
                  ¡Listo{contactName ? `, ${contactName.split(' ')[0]}` : ''}! Recibimos tu solicitud
                </h3>
                <p className="text-sm sm:text-base text-tinta-muted leading-relaxed">
                  Te vamos a escribir al WhatsApp <strong className="text-tinta font-semibold">{whatsappNumber || 'que nos dejaste'}</strong> para
                  coordinar la demo de {businessName ? <strong className="text-tinta font-semibold">{businessName}</strong> : 'tu local'}.
                </p>
              </div>

              <ol className="space-y-3 border-t border-paper-border pt-5">
                {pasos.map((paso, i) => (
                  <li key={paso} className="flex gap-3 text-sm text-tinta">
                    <span className="w-6 h-6 rounded-full border border-terracota/30 text-terracota text-xs font-semibold flex items-center justify-center flex-shrink-0">
                      {i + 1}
                    </span>
                    <span className="pt-0.5">{paso}</span>
                  </li>
                ))}
              </ol>

              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <button
                  onClick={openDirectWhatsApp}
                  className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-terracota hover:bg-terracota-dark text-white text-sm font-semibold rounded-md transition-colors min-h-[46px]"
                >
                  <MessageSquare className="w-4 h-4" />
                  <span>Escribirnos ahora por WhatsApp</span>
                </button>
                <button
                  onClick={handleClose}
                  className="inline-flex items-center justify-center px-5 py-3 border border-paper-border hover:border-bone-faint text-tinta text-sm font-medium rounded-md transition-colors min-h-[46px]"
                >
                  Volver al sitio
                </button>
              </div>
            </div>
          ) : (
            <div>
              {/* Header */}
              <div className="mb-6 pr-10">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-terracota mb-2">
                  Prueba piloto · Mendoza
                </p>
                <h3 id="demo-modal-title" className="font-display font-bold text-2xl sm:text-3xl tracking-tight text-tinta leading-tight">
                  Equipá tu local con BlendBot
                </h3>
                <p className="text-sm text-tinta-muted mt-2 leading-relaxed">
                  Contanos de tu local y preparamos una demo con tu carta y tu forma de trabajar. Te respondemos en menos de 2 horas.
                </p>
              </div>

              {/* Resumen corto para mobile (la columna de valor sólo se ve en desktop) */}
              <ul className="md:hidden grid grid-cols-2 gap-x-3 gap-y-2 mb-6 p-4 rounded-lg bg-terracota-pale text-[13px] text-tinta">
                {incluye.map((item) => (
                  <li key={item.titulo} className="flex gap-2 items-start">
                    <Check className="w-3.5 h-3.5 text-terracota mt-0.5 flex-shrink-0" strokeWidth={3} />
                    <span className="leading-snug">{item.titulo}</span>
                  </li>
                ))}
              </ul>

              {/* Form */}
              <form onSubmit={handleSubmit} className="space-y-4">

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="demo-contacto" className={labelClass}>Tu nombre</label>
                    <input
                      id="demo-contacto"
                      type="text"
                      required
                      autoComplete="name"
                      placeholder="Ej: Martina Gómez"
                      value={contactName}
                      onChange={(e) => setContactName(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="demo-local" className={labelClass}>Restaurante o bodega</label>
                    <input
                      id="demo-local"
                      type="text"
                      required
                      autoComplete="organization"
                      placeholder="Ej: Bistró de Viñedo"
                      value={businessName}
                      onChange={(e) => setBusinessName(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="demo-tipo" className={labelClass}>Tipo de gastronomía</label>
                    <div className="relative">
                      <select
                        id="demo-tipo"
                        value={vertical}
                        onChange={(e) => setVertical(e.target.value)}
                        className={`${inputClass} appearance-none pr-10 cursor-pointer`}
                      >
                        <option value="restaurante">Restaurante de salón / pasos</option>
                        <option value="bodega">Bodega y degustaciones</option>
                        <option value="parrilla">Parrilla / carnes a la brasa</option>
                        <option value="hamburgueseria">Hamburguesería</option>
                        <option value="pizzeria">Pizzería y empanadas</option>
                        <option value="bar">Bar de vinos / cervecería</option>
                      </select>
                      <ChevronDown className="w-4 h-4 text-tinta-muted absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="demo-zona" className={labelClass}>Zona</label>
                    <div className="relative">
                      <select
                        id="demo-zona"
                        value={city}
                        onChange={(e) => setCity(e.target.value)}
                        className={`${inputClass} appearance-none pr-10 cursor-pointer`}
                      >
                        <option value="ciudad">Ciudad de Mendoza / Arístides</option>
                        <option value="chacras">Chacras de Coria / Luján</option>
                        <option value="valle-uco">Valle de Uco</option>
                        <option value="godoy-cruz">Godoy Cruz / Bombal</option>
                        <option value="maipu">Maipú</option>
                        <option value="san-rafael">San Rafael</option>
                        <option value="otra">Otra zona de Mendoza</option>
                      </select>
                      <ChevronDown className="w-4 h-4 text-tinta-muted absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>
                  </div>
                </div>

                <div>
                  <label htmlFor="demo-whatsapp" className={labelClass}>WhatsApp de contacto</label>
                  <input
                    id="demo-whatsapp"
                    type="tel"
                    required
                    autoComplete="tel"
                    placeholder="Ej: 261 450 6070"
                    value={whatsappNumber}
                    onChange={(e) => setWhatsappNumber(e.target.value)}
                    className={inputClass}
                  />
                  <p className="text-xs text-tinta-muted mt-1.5">Te escribimos a este número para coordinar la demo.</p>
                </div>

                <div>
                  <label htmlFor="demo-notas" className={labelClass}>
                    ¿Qué te gustaría resolver primero? <span className="font-normal text-tinta-muted">(opcional)</span>
                  </label>
                  <textarea
                    id="demo-notas"
                    rows={3}
                    placeholder="Ej: se nos pierden pedidos por WhatsApp los fines de semana"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className={`${inputClass} resize-none`}
                  />
                </div>

                <div className="pt-2 space-y-3">
                  <button
                    type="submit"
                    className="group w-full py-3.5 bg-terracota hover:bg-terracota-dark text-white text-sm font-semibold flex items-center justify-center gap-2 rounded-md transition-colors min-h-[48px]"
                  >
                    <span>Solicitar prueba piloto de 2 meses</span>
                    <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                  </button>

                  <p className="flex items-center justify-center gap-1.5 text-xs text-tinta-muted text-center">
                    <ShieldCheck className="w-3.5 h-3.5 text-terracota flex-shrink-0" />
                    <span>Sin permanencia mínima. Instalación en 48 hs en Mendoza.</span>
                  </p>
                </div>

              </form>
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
