/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/renderer/index.html',
    './src/renderer/src/**/*.{js,ts,jsx,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          base: 'rgb(var(--bg-base) / <alpha-value>)',
          panel: 'rgb(var(--bg-panel) / <alpha-value>)',
          subtle: 'rgb(var(--bg-subtle) / <alpha-value>)',
          raised: 'rgb(var(--bg-raised) / <alpha-value>)',
          hover: 'rgb(var(--bg-hover) / <alpha-value>)'
        },
        border: {
          subtle: 'rgb(var(--border-subtle) / <alpha-value>)',
          DEFAULT: 'rgb(var(--border) / <alpha-value>)',
          strong: 'rgb(var(--border-strong) / <alpha-value>)'
        },
        fg: {
          base: 'rgb(var(--fg-base) / <alpha-value>)',
          muted: 'rgb(var(--fg-muted) / <alpha-value>)',
          subtle: 'rgb(var(--fg-subtle) / <alpha-value>)',
          dim: 'rgb(var(--fg-dim) / <alpha-value>)'
        },
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          subtle: 'rgb(var(--accent-subtle) / <alpha-value>)'
        },
        scope: {
          line: 'rgb(var(--scope-line) / <alpha-value>)',
          block: 'rgb(var(--scope-block) / <alpha-value>)',
          file: 'rgb(var(--scope-file) / <alpha-value>)',
          project: 'rgb(var(--scope-project) / <alpha-value>)',
          custom: 'rgb(var(--scope-custom) / <alpha-value>)'
        }
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Menlo', 'Consolas', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif']
      },
      fontSize: {
        '2xs': '0.6875rem'
      }
    }
  },
  plugins: []
}
