import React from 'react';
import { renderToString } from 'react-dom/server';
import App from './App';

// Entrada del bundle SSR que usa scripts/prerender.mjs en el build. No llega
// al navegador: ahí main.tsx hidrata el HTML que esto produjo.
export function render(): string {
  return renderToString(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

export { jsonLd } from './seo';
