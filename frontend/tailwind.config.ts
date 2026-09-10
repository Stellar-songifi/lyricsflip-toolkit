import type { Config } from 'tailwindcss';

// Colours and type roles come from docs/design-handoff.md.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          400: '#8B5CF6',
          600: '#5B21B6',
        },
        accent: {
          300: '#FDE68A',
        },
        canvas: '#0F0B1A',
        surface: '#1A1425',
        'text-primary': '#F5F3FF',
        'text-muted': '#A78BFA',
        success: '#34D399',
        error: '#F87171',
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
