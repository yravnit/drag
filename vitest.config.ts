import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import dotenv from "dotenv";

dotenv.config();

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    globals: true,
    // Tree-sitter WASM tests need a longer timeout
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/lib/ingestion/**", "src/workflows/**"],
      exclude: ["src/lib/ingestion/test-workflow.ts"],
    },
  },
});
