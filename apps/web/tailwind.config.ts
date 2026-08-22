import type { Config } from "tailwindcss";

/**
 * Foundation-only Tailwind config. Sane neutral defaults — no product
 * branding/design tokens invented here; the approved design system arrives
 * in a later phase once design references exist in the repository.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
