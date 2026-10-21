import React from 'react';
import { ArrowUpRight, ArrowUp, Mail, MapPin } from 'lucide-react';

interface MonumentalFooterProps {
  onOpenDemo: () => void;
}

// `ancho` va completo como clase literal: Tailwind no ve clases armadas con
// template strings.
const COLUMNAS: { titulo: string; ancho: string; items: string[] }[] = [
  {
    titulo: 'Sistema integral',
    ancho: 'lg:col-span-3',
    items: ['WhatsApp oficial con IA', 'Comandera táctil KDS', "Switch 'SE ACABÓ'", 'Facturación oficial ARCA'],
  },
  {
    titulo: 'Verticales Mendoza',
    ancho: 'lg:col-span-3',
    items: ['Restaurantes de viñedo', 'Bodegas & degustaciones', 'Bistrós & hamburgueserías', 'Pizzerías & bares'],
  },
  {
    titulo: 'Infraestructura',
    ancho: 'col-span-2 sm:col-span-1 lg:col-span-3',
    items: ['Meta Cloud API homologado', 'Sidecar criptográfico ARCA', 'Puesta en marcha en 48hs', 'Uptime 99.98% 24/7'],
  },
];

export const MonumentalFooter: React.FC<MonumentalFooterProps> = ({ onOpenDemo }) => {
  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <footer className="relative border-t border-dark-border bg-dark text-bone-muted">
      <div className="mx-auto max-w-7xl px-4 pt-14 sm:px-8 sm:pt-20 lg:px-10">

        {/* CTA final */}
        <div className="relative overflow-hidden rounded-sm border border-dark-hover bg-dark-card p-6 sm:p-10 lg:p-12">
          <div className="absolute inset-x-0 top-0 h-1 bg-brand" />
          <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <span className="font-ancha mb-3 block text-[9px] uppercase tracking-widest-editorial text-terracota sm:text-[10px]">
                Gastronomía & bodegas // Mendoza
              </span>
              <h2 className="font-serif text-3xl font-bold leading-[1.05] tracking-tight text-tinta sm:text-5xl lg:text-6xl">
                ¿Listo para equipar
                <span className="block font-display font-black uppercase tracking-tightest">tu restaurante?</span>
              </h2>
              <p className="mt-4 max-w-xl font-sans text-sm text-bone-muted sm:text-base">
                Sumate a los locales de Mendoza que operan con reservas automáticas, comandera en cocina y facturación en regla.
              </p>
            </div>

            <div className="font-ancha flex flex-col gap-3 text-xs sm:flex-row sm:items-center">
              <button
                onClick={onOpenDemo}
                className="flex min-h-[52px] items-center justify-center gap-2 whitespace-nowrap rounded-sm bg-terracota px-7 py-4 font-bold uppercase tracking-wider text-white shadow-sm transition-all duration-200 hover:bg-terracota-light active:scale-95"
              >
                <span>Equipar mi local</span>
                <ArrowUpRight className="h-4 w-4" />
              </button>
              <a
                href="mailto:contacto@blendsoftware.tech"
                className="flex min-h-[52px] items-center justify-center gap-2 whitespace-nowrap rounded-sm border border-terracota/30 bg-white px-6 py-4 uppercase tracking-wider text-tinta transition-colors hover:border-terracota hover:text-terracota"
              >
                <Mail className="h-4 w-4" />
                <span>Escribinos</span>
              </a>
            </div>
          </div>
        </div>

        {/* Marca + columnas */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 py-14 sm:grid-cols-3 sm:py-16 lg:grid-cols-12 lg:gap-8">
          <div className="col-span-2 sm:col-span-3 lg:col-span-3">
            <a href="/" className="group inline-flex items-center gap-3" aria-label="BlendBot, inicio">
              <img src="/logo-blend-mark.svg" alt="" className="h-10 w-10 object-contain" />
              <span>
                <span className="block font-serif text-2xl font-bold leading-none tracking-tight text-tinta transition-colors group-hover:text-terracota">BlendBot</span>
                <span className="font-ancha mt-1 block text-[9px] uppercase tracking-[0.2em] text-bone-muted">por Blend Software</span>
              </span>
            </a>
            <p className="mt-5 max-w-sm font-sans text-sm leading-relaxed">
              El WhatsApp que atiende, la cocina que se entera y la factura que sale sola. Hecho en Mendoza para la gastronomía de Mendoza.
            </p>
            <div className="mt-6 space-y-2.5 font-sans text-sm">
              <a href="mailto:contacto@blendsoftware.tech" className="flex items-center gap-2.5 font-semibold text-terracota transition-colors hover:text-terracota-light">
                <Mail className="h-4 w-4" />
                contacto@blendsoftware.tech
              </a>
              <div className="flex items-center gap-2.5">
                <MapPin className="h-4 w-4 text-terracota" />
                Mendoza, Argentina
              </div>
              <div className="font-ancha flex items-center gap-2 pt-1 text-[10px] uppercase tracking-wider text-verde">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-verde-light opacity-50" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-verde" />
                </span>
                Servicio activo en Mendoza
              </div>
            </div>
          </div>

          {COLUMNAS.map((col) => (
            <div key={col.titulo} className={col.ancho}>
              <span className="font-ancha mb-4 block border-b border-dark-border pb-3 text-[10px] font-bold uppercase tracking-widest text-tinta">
                {col.titulo}
              </span>
              <ul className="space-y-2.5 font-sans text-sm">
                {col.items.map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <span className="mt-[8px] h-1 w-1 flex-shrink-0 rounded-full bg-logo-ochre" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Barra final */}
        <div className="font-ancha flex flex-col items-center justify-between gap-4 border-t border-dark-border py-6 text-center text-[10px] uppercase tracking-wider text-bone-muted sm:flex-row sm:text-left sm:text-[11px]">
          <div>© 2026 BlendBot · Blend Software · Mendoza, Argentina</div>
          <div className="flex items-center gap-5">
            <a href="/privacidad.html" className="transition-colors hover:text-terracota">
              Política de privacidad
            </a>
            <button
              onClick={scrollToTop}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-sm border border-dark-border px-3 uppercase tracking-wider transition-colors hover:border-terracota hover:text-terracota"
            >
              Arriba <ArrowUp className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      <div className="h-1.5 bg-brand" />
    </footer>
  );
};
