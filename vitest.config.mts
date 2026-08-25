import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * Two projects rather than one, because the suites need different globals:
 *
 *   node  pure logic (errors, logger, validation, config) and the Supabase
 *         client factories, which must work without a DOM.
 *   dom   component rendering with Testing Library.
 *
 * Section 21 of CLOVERCODE_MASTER.md separates unit / integration /
 * authorization / e2e. Authorization and e2e suites arrive with the phases
 * that introduce data (03) and screens (05).
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` throws under Node's default export condition; Next
      // resolves it through the `react-server` condition instead. Tests get an
      // inert stub so a server module can be imported directly.
      "server-only": fileURLToPath(new URL("./src/tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    globals: false,
    passWithNoTests: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/lib/**", "src/config/**", "src/components/**"],
      exclude: ["src/**/index.ts", "src/tests/**"],
    },
    projects: [
      {
        plugins: [react()],
        resolve: {
          alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
            "server-only": fileURLToPath(
              new URL("./src/tests/stubs/server-only.ts", import.meta.url),
            ),
          },
        },
        test: {
          name: "node",
          environment: "node",
          include: ["src/tests/unit/**/*.test.ts", "src/tests/integration/**/*.test.ts"],
        },
      },
      {
        plugins: [react()],
        resolve: {
          alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
            "server-only": fileURLToPath(
              new URL("./src/tests/stubs/server-only.ts", import.meta.url),
            ),
          },
        },
        test: {
          name: "dom",
          environment: "jsdom",
          setupFiles: ["./src/tests/setup.dom.ts"],
          include: ["src/tests/components/**/*.test.tsx"],
        },
      },
    ],
  },
});
