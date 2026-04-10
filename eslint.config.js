// ESLint only lints plain JS/JSX. TypeScript files are checked by tsc (npm run build).
// @typescript-eslint/parser is not installed, so TS parsing would fail.
export default [
  {
    ignores: ["dist/**", "node_modules/**", "**/*.ts", "**/*.tsx"],
  },
  {
    files: ["**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      "no-unused-vars": "warn",
      "no-console": "warn",
    },
  },
];
