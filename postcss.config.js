export default {
  plugins: {
    // Root Tailwind's automatic class detection at src/ (plus the content globs in
    // tailwind.config.js), so editing docs at the repo root cannot change the CSS.
    '@tailwindcss/postcss': { base: './src' },
  },
}
