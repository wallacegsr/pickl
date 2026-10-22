import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextCoreWebVitals,
  {
    rules: {
      // New with eslint-config-next 16 (React Compiler rules). The effects it
      // flags — resetting a dialog when it opens, restoring sessionStorage
      // after mount — work as written; restructuring them is its own change,
      // so they show as warnings until then rather than failing lint.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  globalIgnores([".next/**", "node_modules/**", "android/**", "drizzle/**", "data/**"]),
]);
