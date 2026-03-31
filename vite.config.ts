import { configDefaults, defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [vue()],
  test: {
    exclude: [...configDefaults.exclude, "e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: [
        "src/composables/usePaneLayout.ts",
        "src/composables/useUserSettings.ts",
        "src/constants/createObjectTemplates.ts",
      ],
      thresholds: {
        statements: 100,
        branches: 90,
        functions: 100,
        lines: 100,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return;
          }

          if (id.includes("@codemirror") || id.includes("/codemirror/")) {
            return "vendor-codemirror";
          }

          if (id.includes("@tauri-apps")) {
            return "vendor-tauri";
          }

          if (id.includes("/vue/") || id.includes("@vue/")) {
            return "vendor-vue";
          }
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
