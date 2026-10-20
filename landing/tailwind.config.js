/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Paleta del logo de Blend Software sobre fondos claros.
        // Los nombres vienen del diseño oscuro original: "dark" son las
        // superficies (ahora claras) y "bone" el texto sobre ellas.
        dark: {
          DEFAULT: '#FFFFFF',
          deep: '#F2F2EE',
          surface: '#F4F4F0',
          card: '#ECF6F7',
          hover: '#D7ECEF',
          border: '#E1E2DC',
        },
        paper: {
          DEFAULT: '#FFFFFF',
          pure: '#FFFFFF',
          warm: '#FAF7E6',
          border: '#E1E2DC',
        },
        tinta: {
          DEFAULT: '#141B1D',
          muted: '#5E6A6D',
        },
        bone: {
          DEFAULT: '#3B4649',
          light: '#141B1D',
          muted: '#5E6A6D',
          faint: '#8A9497',
        },
        // Acento principal: el teal del logo, en el tono que se lee sobre blanco
        terracota: {
          DEFAULT: '#1C5A61',
          light: '#4E8F98',
          dark: '#0F3F45',
          pale: '#ECF6F7',
        },
        verde: {
          DEFAULT: '#1F6B45',
          light: '#2E8A5C',
        },
        ambar: {
          DEFAULT: '#B78801',
        },
        logo: {
          teal: '#73ABB5',
          olive: '#C4B23D',
          gold: '#CFB23A',
          ochre: '#B78801',
        },
      },
      backgroundImage: {
        // Degradé del logo (teal → oliva → dorado → ocre)
        brand: 'linear-gradient(100deg, #73ABB5 0%, #C4B23D 45%, #CFB23A 70%, #B78801 100%)',
      },
      fontFamily: {
        // Archivo y Onest son las de blendsoftware. "serif" quedó del diseño
        // original: hoy los títulos editoriales también van en Archivo, sin
        // cursivas ni trazos finos.
        display: ['Archivo', '"Arial Black"', 'sans-serif'],
        serif: ['Archivo', 'system-ui', 'sans-serif'],
        sans: ['Onest', 'system-ui', 'sans-serif'],
        // Etiquetas y datos chicos: Archivo ancha (ver .font-ancha en index.css)
        ancha: ['Archivo', '"Arial Black"', 'sans-serif'],
      },
      letterSpacing: {
        'tightest': '-0.05em',
        'tighter': '-0.035em',
        'widest-editorial': '0.25em',
      },
    },
  },
  plugins: [],
}
