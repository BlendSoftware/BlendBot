import { FAQ_DATA } from './data/faqData';

// Datos estructurados (schema.org) que el prerender mete en el <head>.
// El FAQ sale de FAQ_DATA, la misma lista que pinta FaqSection: si cambia una
// pregunta, cambia en los dos lados.
export function jsonLd(siteUrl: string): object[] {
  const organizacion = {
    '@type': 'Organization',
    '@id': `${siteUrl}/#org`,
    name: 'Blend Software',
    url: siteUrl,
    logo: `${siteUrl}/apple-touch-icon.png`,
    email: 'contacto@blendsoftware.tech',
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'Mendoza',
      addressRegion: 'Mendoza',
      addressCountry: 'AR',
    },
  };

  return [
    { '@context': 'https://schema.org', ...organizacion },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'BlendBot',
      url: siteUrl,
      inLanguage: 'es-AR',
      publisher: { '@id': `${siteUrl}/#org` },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'BlendBot',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web, WhatsApp',
      description:
        'Atención y pedidos por WhatsApp con IA, comandera de cocina y facturación electrónica ARCA para restaurantes y bodegas de Mendoza.',
      url: siteUrl,
      image: `${siteUrl}/og-image.png`,
      areaServed: { '@type': 'AdministrativeArea', name: 'Mendoza, Argentina' },
      offers: {
        '@type': 'Offer',
        price: '79000',
        priceCurrency: 'ARS',
        priceSpecification: {
          '@type': 'UnitPriceSpecification',
          price: '79000',
          priceCurrency: 'ARS',
          unitCode: 'MON',
        },
      },
      publisher: { '@id': `${siteUrl}/#org` },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: FAQ_DATA.map((f) => ({
        '@type': 'Question',
        name: f.question,
        acceptedAnswer: { '@type': 'Answer', text: f.answer },
      })),
    },
  ];
}
