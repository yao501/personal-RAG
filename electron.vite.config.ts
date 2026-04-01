import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "dist-electron/main"
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "dist-electron/preload",
      rollupOptions: {
        output: {
          format: "cjs",
          entryFileNames: "[name].js"
        }
      }
    }
  },
  renderer: {
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: 5173
    },
    build: {
      outDir: "dist/renderer",
      rollupOptions: {
        input: {
          index: "src/renderer/index.html"
        }
      }
    }
  }
});
