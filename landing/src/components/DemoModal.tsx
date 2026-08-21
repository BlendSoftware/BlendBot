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
  const [vertical, setVertical] = useState('hamburgueseria');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [city, setCity] = useState('');
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
    const msg = encodeURIComponent(`Hola! Quiero solicitar la prueba piloto de 2 meses de BlendBot para mi local: ${businessName || 'mi local'}.`);
    window.open(`https://wa.me/5491100000000?text=${msg}`, '_blank');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-lg bg-paper-pure text-tinta border border-paper-border shadow-2xl p-6 sm:p-8 font-sans overflow-hidden rounded-sm">
        
        {/* Close Button */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 p-2 text-tinta-muted hover:text-tinta hover:bg-paper-warm rounded transition-colors"
          aria-label="Cerrar modal"
        >
          <X className="w-5 h-5" />
        </button>

        {isSubmitted ? (
          <div className="text-center py-8 space-y-4 font-sans">
            <div className="w-12 h-12 bg-paper-warm border border-paper-border text-terracota rounded-full flex items-center justify-center mx-auto">
              <CheckCircle className="w-6 h-6" />
            </div>
            <h3 className="font-serif italic font-bold text-2xl text-tinta">
              Solicitud recibida
            </h3>
            <p className="text-sm text-tinta-muted leading-relaxed max-w-sm mx-auto font-light">
              Te contactaremos al WhatsApp <strong className="text-tinta font-mono">{whatsappNumber || 'indicado'}</strong> en menos de 2 horas para coordinar la prueba y cargar tu carta.
            </p>
            <div className="pt-4">
              <button
                onClick={openDirectWhatsApp}
                className="inline-flex items-center gap-2 px-5 py-3 bg-terracota hover:bg-terracota-light text-white font-mono text-xs uppercase font-bold tracking-wider rounded-sm transition-colors shadow-md"
              >
                <MessageSquare className="w-4 h-4" />
                <span>Escribirnos directo por WhatsApp</span>
              </button>
            </div>
          </div>
        ) : (
          <div>
            {/* Header */}
            <div className="mb-6">
              <div className="font-mono text-[10px] text-terracota uppercase tracking-widest-editorial mb-1 font-bold">
                [ PRUEBA PILOTO // 2 MESES BONIFICADO ]
              </div>
              <h3 className="font-serif italic font-bold text-2xl sm:text-3xl text-tinta">
                Incorporá BlendBot a tu local
              </h3>
              <p className="text-xs text-tinta-muted mt-1 font-light">
                Completá los datos y preparamos una demostración con la carta real de tu cocina.
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4 font-mono text-xs">
              
              <div>
                <label className="block text-tinta-muted uppercase mb-1 font-semibold">
                  Nombre de tu Local / Marca:
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej: Fuego & Pan Burguesería"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  className="w-full bg-paper-warm border border-paper-border focus:border-terracota p-3 text-tinta outline-none transition-colors rounded-sm"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-tinta-muted uppercase mb-1 font-semibold">
                    Vertical Gastronómico:
                  </label>
                  <select
                    value={vertical}
                    onChange={(e) => setVertical(e.target.value)}
                    className="w-full bg-paper-warm border border-paper-border focus:border-terracota p-3 text-tinta outline-none transition-colors rounded-sm"
                  >
                    <option value="hamburgueseria">Hamburguesería / Smash</option>
                    <option value="pizzeria">Pizzería & Empanadas</option>
                    <option value="parrilla">Parrilla / Carnes</option>
                    <option value="cafe">Café de Especialidad</option>
                    <option value="restaurante">Restaurante de Autor</option>
                    <option value="bar">Bar & Coctelería</option>
                  </select>
                </div>

                <div>
                  <label className="block text-tinta-muted uppercase mb-1 font-semibold">
                    Ciudad / Zona:
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ej: CABA / Rosario"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className="w-full bg-paper-warm border border-paper-border focus:border-terracota p-3 text-tinta outline-none transition-colors rounded-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-tinta-muted uppercase mb-1 font-semibold">
                  WhatsApp del Titular / Encargado:
                </label>
                <input
                  type="tel"
                  required
                  placeholder="Ej: 11 4050 6070"
                  value={whatsappNumber}
                  onChange={(e) => setWhatsappNumber(e.target.value)}
                  className="w-full bg-paper-warm border border-paper-border focus:border-terracota p-3 text-tinta outline-none transition-colors rounded-sm"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  className="w-full py-3.5 bg-terracota hover:bg-terracota-light text-white font-mono text-xs uppercase font-bold tracking-wider flex items-center justify-center gap-2 rounded-sm transition-all active:scale-98 shadow-md"
                >
                  <span>Solicitar Prueba Piloto (2 Meses)</span>
                </button>
              </div>

              <div className="text-[10px] text-center text-tinta-muted pt-1">
                Cupos limitados por camada para garantizar atención personalizada.
              </div>

            </form>
          </div>
        )}

      </div>
    </div>
  );
};
