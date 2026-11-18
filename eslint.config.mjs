import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextCoreWebVitals,
  {
    rules: {
      // New with eslint-config-next 16 (React Compiler rules). State that
      // follows a prop is adjusted during render; the effects that remain read
      // browser-only state after mount and carry a disable with their reason.
      "react-hooks/set-state-in-effect": "error",
    },
  },
  globalIgnores([".next/**", "node_modules/**", "android/**", "drizzle/**", "data/**"]),
]);
