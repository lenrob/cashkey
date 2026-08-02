// `defineConfig` comes from vitest/config rather than vite so that the `test`
// key below is typed. Vite ignores that key at build time.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Test config lives here rather than in a separate vitest.config.ts so the
  // `@/` alias above cannot drift between the build and the test run.
  test: {
    // R-QA-1 covers pure logic only — no component rendering, so no DOM
    // implementation is needed. Node supplies URL and URLSearchParams; the
    // few functions touching window are stubbed per test with vi.stubGlobal.
    environment: "node",
    // Explicit imports from "vitest" instead of injected globals, so no
    // "types": ["vitest/globals"] entry is needed in tsconfig.app.json.
    globals: false,
    include: ["src/**/*.test.ts"],
  },
});
