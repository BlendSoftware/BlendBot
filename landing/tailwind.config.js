/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        dark: {
          DEFAULT: '#0D0D0F',
          deep: '#080809',
          surface: '#131316',
          card: '#18181C',
          hover: '#222228',
          border: '#2A2930',
        },
        paper: {
          DEFAULT: '#FAF7F2',
          pure: '#FFFFFF',
          warm: '#F3EDE2',
          border: '#E2DAD0',
        },
        tinta: {
          DEFAULT: '#191816',
          muted: '#5A564F',
        },
        bone: {
          DEFAULT: '#F5F2EB',
          light: '#FFFFFF',
          muted: '#A5A096',
          faint: '#605C55',
        },
        terracota: {
          DEFAULT: '#C85A32',
          light: '#DE6A40',
          dark: '#A6431F',
          pale: '#FBECE6',
        },
        verde: {
          DEFAULT: '#3B7A57',
          light: '#4E9B71',
        },
        ambar: {
          DEFAULT: '#D68B2C',
        }
      },
      fontFamily: {
        display: ['Syne', 'sans-serif'],
        serif: ['"Playfair Display"', 'Georgia', 'serif'],
        sans: ['"Space Grotesk"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
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
