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
          subtle: withOpacity("--brand-subtle"),
          "subtle-foreground": withOpacity("--brand-subtle-foreground"),
        },
        success: { DEFAULT: withOpacity("--success"), subtle: withOpacity("--success-subtle") },
        warning: { DEFAULT: withOpacity("--warning"), subtle: withOpacity("--warning-subtle") },
        danger: { DEFAULT: withOpacity("--danger"), subtle: withOpacity("--danger-subtle") },
        info: { DEFAULT: withOpacity("--info"), subtle: withOpacity("--info-subtle") },
        ring: withOpacity("--ring"),
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
      },
      fontFamily: {
        sans: ["var(--font-plex-arabic)", "var(--font-inter)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        xs: "0 1px 2px 0 rgb(15 23 42 / 0.04)",
        sm: "0 1px 3px 0 rgb(15 23 42 / 0.06), 0 1px 2px -1px rgb(15 23 42 / 0.06)",
        md: "0 4px 10px -2px rgb(15 23 42 / 0.08), 0 2px 4px -2px rgb(15 23 42 / 0.06)",
        lg: "0 12px 24px -6px rgb(15 23 42 / 0.10), 0 4px 8px -4px rgb(15 23 42 / 0.06)",
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
