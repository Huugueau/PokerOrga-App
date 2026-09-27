/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // graphite neutre
        ink: { 950: '#0b0d10', 900: '#111418', 800: '#181c21', 700: '#222830', 600: '#2e3540', 500: '#434c59' },
        // vert-de-gris discret, utilisé avec parcimonie
        accent: { 300: '#a7d8c5', 400: '#72bfa2', 500: '#4ea486', 600: '#3a866b', 700: '#2c6a55' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: { glass: '0 12px 32px -16px rgba(0,0,0,.7)' },
    },
  },
  plugins: [],
};
