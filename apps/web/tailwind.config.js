/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { 950: '#07111e', 900: '#0a1828', 800: '#10223a', 700: '#18304f', 600: '#234066', 500: '#35557f' },
        gold: { 300: '#e6cf8a', 400: '#d8b964', 500: '#c9a449', 600: '#a8852f', 700: '#7d6322' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: { glass: '0 10px 40px -12px rgba(0,0,0,.6)' },
    },
  },
  plugins: [],
};
