/** @type {import('tailwindcss').Config} */
// Branding note: the Facebook reference (fb.com/juanpalamanofficial) is login-
// gated, so these are a warm Filipino-food-inspired palette. Swap the hex
// values here to match the real brand guide — every screen reads from these.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#fff5ef',
          100: '#ffe6d6',
          200: '#ffc7a8',
          300: '#ffa173',
          400: '#fb7440',
          500: '#e8521d', // primary tomato/achuete red-orange
          600: '#c63f13',
          700: '#a23214',
          800: '#7f2b16',
          900: '#682615',
        },
        gold: {
          400: '#f7b733',
          500: '#f0a202', // golden accent
          600: '#cc8400',
        },
        cream: '#fdf8f1',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Avenir', 'Helvetica', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
