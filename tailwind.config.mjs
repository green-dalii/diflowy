/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
  theme: {
    extend: {
      fontFamily: {
        grotesk: ["sans-serif"],
      },
      fontWeight: {
        regular: 400,
        medium: 500,
      },
      colors: {
        blue: "var(--blue)",
        black: "var(--black)",
        dark: "var(--dark)",
        white: "var(--white)",
        'blues': {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#172554',
        }
      },
      backgroundImage: {
        "gradient-radial-at-bottom-center": "radial-gradient(at center bottom, var(--tw-gradient-stops))",
      }
    },
  },
  plugins: [
    require("daisyui"),
  ],
};
