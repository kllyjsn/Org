/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'sans-serif',
        ],
      },
      colors: {
        brand: {
          DEFAULT: '#5b4cf0',
          hover: '#6b5cf8',
          deep: '#4b3ddd',
          text: '#5144d7',
          muted: '#796df5',
          faint: '#8b82ee',
          line: '#b9b2ff',
          soft: '#eeecff',
          softer: '#e3dfff',
          tint: '#f5f4ff',
        },
        accent: {
          DEFAULT: '#c9f04b',
          hover: '#d6f56b',
          soft: '#effbd0',
          softer: '#e4f7b7',
        },
        paper: '#f6f7f2',
        sheet: '#f9faf7',
        ink: '#101828',
      },
      boxShadow: {
        node: '0 8px 24px rgba(15,23,42,.08)',
        cta: '0 10px 24px rgba(91,76,240,.22)',
        panel: '0 10px 35px rgba(15,23,42,.1)',
      },
      transitionDuration: { DEFAULT: '200ms' },
      transitionTimingFunction: { DEFAULT: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    },
  },
  plugins: [],
};
