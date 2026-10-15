/**
 * KODA — configuración de Tailwind.
 *
 * Sistema "Obsidiana + Brasa": superficies casi negras con tinte cálido y el
 * naranja de Connexo como único acento. Las superficies y los colores de acento
 * se definen como canales RGB en CSS (ver src/styles/index.css) para que Tailwind
 * pueda aplicar opacidad: `bg-accent/10`, `border-accent/30`, `text-danger`.
 */
const channel = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

module.exports = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── Marca Connexo (referencia fija) ────────────────────────────
        brand: {
          orange: '#ff6600',
          dark: '#210900',
          border: '#962700',
          peach: '#ffa35d',
          text: '#ffefe5',
        },
        // ── Superficies (canales RGB, con tema) ────────────────────────
        surface: {
          void: channel('void'),       // fondo de página
          base: channel('base'),       // sidebar / topbar
          raised: channel('raised'),   // paneles
          elevated: channel('elevated'), // hover, cabeceras, chips
          inset: channel('inset'),     // campos de entrada
        },
        // Capa de interacción: velo claro (tema oscuro) u oscuro (tema claro)
        veil: channel('veil'),
        // ── Texto ──────────────────────────────────────────────────────
        ink: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
        },
        line: 'var(--line)',
        'line-strong': 'var(--line-strong)',
        // ── Acento ─────────────────────────────────────────────────────
        accent: {
          DEFAULT: channel('accent'),   // rellenos y bordes
          text: channel('accent-text'), // texto/iconos de acento sobre superficie
          soft: channel('peach'),
          on: channel('on-accent'),     // texto sobre relleno de acento
        },
        // ── Semánticos ─────────────────────────────────────────────────
        success: channel('success'),
        warning: channel('warning'),
        danger: channel('danger'),
        info: channel('info'),
        // ── Bandas de KODA Score ───────────────────────────────────────
        score: {
          hot: 'var(--score-hot)',
          good: 'var(--score-good)',
          warm: 'var(--score-warm)',
          cold: 'var(--score-cold)',
        },
      },
      fontFamily: {
        sans: ['Space Grotesk', 'system-ui', 'sans-serif'],
        heading: ['Tomorrow', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
      },
      boxShadow: {
        glow: '0 0 0 1px rgb(var(--c-accent) / 0.35), 0 8px 28px -10px rgb(var(--c-accent) / 0.45)',
        panel: 'var(--shadow-panel)',
        pop: 'var(--shadow-pop)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'fade-in-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'none' },
        },
        'slide-in-right': {
          from: { opacity: '0', transform: 'translateX(12px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.18s ease-out both',
        'fade-in-up': 'fade-in-up 0.22s cubic-bezier(0.16, 1, 0.3, 1) both',
        'slide-in-right': 'slide-in-right 0.22s cubic-bezier(0.16, 1, 0.3, 1) both',
      },
    },
  },
  plugins: [],
};
