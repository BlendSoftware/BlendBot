import React, { useState } from 'react';
import { X, CheckCircle, MessageSquare } from 'lucide-react';
import { sounds } from '../utils/audio';
import confetti from 'canvas-confetti';

interface DemoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DemoModal: React.FC<DemoModalProps> = ({ isOpen, onClose }) => {
  const [businessName, setBusinessName] = useState('');
  const [vertical, setVertical] = useState('restaurante');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [city, setCity] = useState('ciudad');
  const [isSubmitted, setIsSubmitted] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sounds.playKitchenBell();
    setIsSubmitted(true);

    try {
      confetti({
        particleCount: 40,
        spread: 60,
        origin: { y: 0.6 },
        colors: ['#C85A32', '#FAF7F2', '#191816']
      });
    } catch {
      // Silently catch
    }
  };

  const handleClose = () => {
    sounds.playClick();
    setIsSubmitted(false);
    onClose();
  };

  const openDirectWhatsApp = () => {
    sounds.playClick();
    const msg = encodeURIComponent(`Hola! Quiero solicitar el equipamiento completo de BlendBot para mi restaurante/bodega en Mendoza: ${businessName || 'mi local'}.`);
    window.open(`https://wa.me/5492610000000?text=${msg}`, '_blank');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-lg bg-paper-pure text-tinta border border-paper-border shadow-2xl p-5 sm:p-8 font-sans rounded-t-lg sm:rounded-sm max-h-[92vh] overflow-y-auto">
        
        {/* Close Button (Easy Tap Target) */}
        <button
          onClick={handleClose}
          className="absolute top-3 right-3 sm:top-4 sm:right-4 p-2.5 text-tinta-muted hover:text-tinta hover:bg-paper-warm rounded transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
          aria-label="Cerrar modal"
        >
          <X className="w-5 h-5" />
        </button>

        {isSubmitted ? (
          <div className="text-center py-6 sm:py-8 space-y-4 font-sans">
            <div className="w-12 h-12 bg-paper-warm border border-paper-border text-terracota rounded-full flex items-center justify-center mx-auto">
              <CheckCircle className="w-6 h-6" />
            </div>
            <h3 className="font-serif italic font-bold text-xl sm:text-2xl text-tinta">
              Solicitud de equipamiento recibida
            </h3>
            <p className="text-xs sm:text-sm text-tinta-muted leading-relaxed max-w-sm mx-auto font-light">
              Te contactaremos al WhatsApp <strong className="text-tinta font-mono">{whatsappNumber || 'indicado'}</strong> en menos de 2 horas para coordinar la demo en vivo en Mendoza y cargar tu carta.
            </p>
            <div className="pt-3">
              <button
                onClick={openDirectWhatsApp}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3.5 bg-terracota hover:bg-terracota-light text-white font-mono text-xs uppercase font-bold tracking-wider rounded-sm transition-colors shadow-md min-h-[48px]"
              >
                <MessageSquare className="w-4 h-4" />
                <span>Escribirnos directo por WhatsApp</span>
              </button>
            </div>
          </div>
        ) : (
          <div>
            {/* Header */}
            <div className="mb-5 sm:mb-6 pr-8">
              <div className="font-mono text-[9px] sm:text-[10px] text-terracota uppercase tracking-widest-editorial mb-1 font-bold">
                [ EQUIPAMIENTO GASTRONÓMICO // MENDOZA ]
              </div>
              <h3 className="font-serif italic font-bold text-xl sm:text-3xl text-tinta leading-tight">
                Equipá tu local con BlendBot
              </h3>
              <p className="text-xs text-tinta-muted mt-1 font-light">
                Completá los datos y preparamos una demostración con el esquema real de tu restaurante o bodega.
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-4 font-mono text-xs">
              
              <div>
                <label className="block text-tinta-muted uppercase mb-1 font-semibold text-[11px]">
                  Nombre de tu Restaurante / Bodega:
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej: Bodega & Bistró de Viñedo"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  className="w-full bg-paper-warm border border-paper-border focus:border-terracota p-3 text-tinta outline-none transition-colors rounded-sm min-h-[44px]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <label className="block text-tinta-muted uppercase mb-1 font-semibold text-[11px]">
                    Tipo de Gastronomía:
                  </label>
                  <select
                    value={vertical}
                    onChange={(e) => setVertical(e.target.value)}
                    className="w-full bg-paper-warm border border-paper-border focus:border-terracota p-3 text-tinta outline-none transition-colors rounded-sm min-h-[44px]"
                  >
                    <option value="restaurante">Restaurante de Salón / Pasos</option>
                    <option value="bodega">Bodega & Degustaciones</option>
                    <option value="parrilla">Parrilla / Carnes a la Brasa</option>
                    <option value="hamburgueseria">Hamburguesería / Smash</option>
                    <option value="pizzeria">Pizzería & Empanadas</option>
                    <option value="bar">Bar de Vinos / Cervecería</option>
                  </select>
                </div>

                <div>
                  <label className="block text-tinta-muted uppercase mb-1 font-semibold text-[11px]">
                    Zona en Mendoza:
                  </label>
                  <select
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className="w-full bg-paper-warm border border-paper-border focus:border-terracota p-3 text-tinta outline-none transition-colors rounded-sm min-h-[44px]"
                  >
                    <option value="ciudad">Ciudad de Mendoza / Arístides</option>
                    <option value="chacras">Chacras de Coria / Luján</option>
                    <option value="valle-uco">Valle de Uco (Tunuyán, Tupungato)</option>
                    <option value="godoy-cruz">Godoy Cruz / Bombal</option>
                    <option value="maipu">Maipú</option>
                    <option value="san-rafael">San Rafael</option>
                    <option value="otra">Otra zona de Mendoza</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-tinta-muted uppercase mb-1 font-semibold text-[11px]">
                  WhatsApp del Titular / Encargado:
                </label>
                <input
                  type="tel"
                  required
                  placeholder="Ej: 261 450 6070"
                  value={whatsappNumber}
                  onChange={(e) => setWhatsappNumber(e.target.value)}
                  className="w-full bg-paper-warm border border-paper-border focus:border-terracota p-3 text-tinta outline-none transition-colors rounded-sm min-h-[44px]"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  className="w-full py-4 bg-terracota hover:bg-terracota-light text-white font-mono text-xs uppercase font-bold tracking-wider flex items-center justify-center gap-2 rounded-sm transition-all active:scale-98 shadow-md min-h-[48px]"
                >
                  <span>Solicitar Prueba Piloto (2 Meses)</span>
                </button>
              </div>

              <div className="text-[10px] text-center text-tinta-muted pt-1">
                Puesta en marcha e instalación en 48hs en Mendoza.
              </div>

            </form>
          </div>
        )}

      </div>
    </div>
  );
};
