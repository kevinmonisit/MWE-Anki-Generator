/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html'],
  theme: {
    extend: {
      colors: {
        'bg-primary': '#1a1a2e',
        'bg-secondary': '#16213e',
        'bg-tertiary': '#121a30',
        'border-primary': '#0f3460',
        'accent': '#e94560',
        'accent-hover': '#c73a52',
        'success': '#2ed573',
      },
      fontFamily: {
        mono: ["'SF Mono'", "'Fira Code'", 'monospace'],
      },
    },
  },
  plugins: [],
};
