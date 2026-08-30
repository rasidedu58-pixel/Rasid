import type { Config } from "tailwindcss";

/**
 * Rasid design system — Tailwind theme. Reads the CSS custom properties
 * defined in `globals.css` so component code writes semantic classes
 * (`bg-surface`, `text-secondary`, `border-brand`) instead of raw hex/HSL —
 * a single place to retune the palette later. `content` also scans
 * `packages/ui` since that is where the shared component library lives.
 */
const withOpacity = (variable: string) => `hsl(var(${variable}) / <alpha-value>)`;

const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}", "../../packages/ui/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: withOpacity("--background"),
        foreground: withOpacity("--foreground"),
        surface: {
          DEFAULT: withOpacity("--surface"),
          raised: withOpacity("--surface-raised"),
          sunken: withOpacity("--surface-sunken"),
        },
        border: {
          DEFAULT: withOpacity("--border"),
          strong: withOpacity("--border-strong"),
        },
        text: {
          primary: withOpacity("--text-primary"),
          secondary: withOpacity("--text-secondary"),
          tertiary: withOpacity("--text-tertiary"),
        },
        brand: {
          DEFAULT: withOpacity("--brand"),
          foreground: withOpacity("--brand-foreground"),
          strong: withOpacity("--brand-strong"),
          secondary: withOpacity("--brand-secondary"),
          subtle: withOpacity("--brand-subtle"),
          "subtle-foreground": withOpacity("--brand-subtle-foreground"),
        },
        accent: {
          DEFAULT: withOpacity("--accent"),
          foreground: withOpacity("--accent-foreground"),
        },
        success: { DEFAULT: withOpacity("--success"), subtle: withOpacity("--success-subtle") },
        warning: { DEFAULT: withOpacity("--warning"), subtle: withOpacity("--warning-subtle") },
        danger: { DEFAULT: withOpacity("--danger"), subtle: withOpacity("--danger-subtle") },
        info: { DEFAULT: withOpacity("--info"), subtle: withOpacity("--info-subtle") },
        ring: withOpacity("--ring"),
        shell: {
          DEFAULT: withOpacity("--shell-surface"),
          hover: withOpacity("--shell-surface-hover"),
          border: withOpacity("--shell-border"),
          text: withOpacity("--shell-text"),
          "text-muted": withOpacity("--shell-text-muted"),
          active: withOpacity("--shell-active-bg"),
          "active-text": withOpacity("--shell-active-text"),
          accent: withOpacity("--shell-accent"),
        },
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
      },
      fontFamily: {
        sans: ["var(--font-plex-arabic)", "var(--font-geist-sans)", "system-ui", "sans-serif"],
        // Marketing display face (Alexandria); falls back to Plex/system so it
        // is safe anywhere even before the marketing scope applies it.
        display: ["var(--font-alexandria)", "var(--font-plex-arabic)", "system-ui", "sans-serif"],
      },
      backgroundImage: {
        "gradient-hero": "linear-gradient(135deg, #0D9488 0%, #6366F1 50%, #0EA5E9 100%)",
        "gradient-cta": "linear-gradient(90deg, #0D9488, #14B8A6)",
        "gradient-text": "linear-gradient(90deg, #0D9488, #6366F1)",
      },
      boxShadow: {
        xs: "0 1px 2px 0 rgb(0 0 0 / 0.20)",
        sm: "0 1px 3px 0 rgb(0 0 0 / 0.30), 0 1px 2px -1px rgb(0 0 0 / 0.20)",
        md: "0 4px 12px -2px rgb(0 0 0 / 0.35), 0 2px 6px -2px rgb(0 0 0 / 0.25)",
        lg: "0 12px 28px -6px rgb(0 0 0 / 0.45), 0 4px 10px -4px rgb(0 0 0 / 0.30)",
        floating: "0 18px 40px -10px rgb(0 0 0 / 0.55), 0 8px 16px -6px rgb(0 0 0 / 0.35)",
        // Design System v2 depth/glow
        glow: "0 0 40px rgb(13 148 136 / 0.30), 0 0 80px rgb(13 148 136 / 0.10)",
        "card-hover": "0 8px 30px rgb(13 148 136 / 0.12), 0 4px 12px rgb(0 0 0 / 0.40)",
        elevated: "0 20px 60px rgb(0 0 0 / 0.50)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "slide-in-from-end": { from: { transform: "translateX(8px)", opacity: "0" }, to: { transform: "translateX(0)", opacity: "1" } },
      },
      animation: {
        "fade-in": "fade-in 150ms ease-out",
        "slide-in-from-end": "slide-in-from-end 150ms ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
