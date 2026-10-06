import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Underscore-prefixed params are intentionally unused (mock signatures).
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // src/app/page.tsx intentionally resets selection state and kicks off
      // fetches inside effects (reset-on-change / fetch-on-modal-open). The
      // rule also cannot model async/await, so it flags plain fetch-on-mount.
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    // Test doubles and drizzle mock chains are cast liberally on purpose.
    files: ["src/**/__tests__/**/*.ts", "src/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "src/app/.well-known/**",
  ]),
]);

export default eslintConfig;
