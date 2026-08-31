/**
 * KODA — configuración de Tailwind.
 * Tokens copiados de Connexo Clients (tailwind.config.cjs + index.html).
 * NO inventar colores nuevos: lo único propio de KODA son las 4 bandas de
 * score, derivadas de la paleta de Connexo (ver sección 10.1 del doc técnico).
 */
module.exports = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // ── Marca Connexo (paleta estricta) ────────────────────────────
        brand: {
          orange: '#ff6600', // Primary Action
          dark: '#210900',   // Background Base
          border: '#962700', // Secondary / Borders
          peach: '#ffa35d',  // Accent / Hover
          text: '#ffefe5',   // Primary Text
        },
        // Alias semánticos apuntando a las variables CSS (soportan tema claro)
        surface: {
          base: 'var(--background-dark)',
          raised: 'var(--background-card)',
          elevated: 'var(--background-elevated)',
        },
        ink: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
        },
        line: 'var(--card-border)',
        // ── Bandas de KODA Score (único añadido de KODA) ───────────────
        score: {
          hot: 'var(--score-hot)',   // Caliente — acento Connexo 100% (peach)
          good: 'var(--score-good)', // Bueno — marca principal (orange)
          warm: 'var(--score-warm)', // Tibio — marca al 40% de saturación
          cold: 'var(--score-cold)', // Frío — gris ink.muted
        },
      },
      fontFamily: {
        sans: ['Space Grotesk', 'system-ui', 'sans-serif'],
        heading: ['Tomorrow', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
      },
      boxShadow: {
        glow: '0 0 20px rgba(255, 102, 0, 0.25)',
      },
      keyframes: {
        'fade-in-up': {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'none' },
        },
        'slide-in-right': {
          from: { opacity: '0', transform: 'translateX(20px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
      },
      animation: {
        'fade-in-up': 'fade-in-up 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'slide-in-right': 'slide-in-right 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
      },
    },
  },
  plugins: [],
};
