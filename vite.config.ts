/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/party-bet-arena/",
  plugins: [
    react(),
    {
      // The production CSP only allows Firebase hosts. During local development we also
      // need to reach the Auth and Realtime Database emulators.
      name: "local-emulator-csp",
      apply: "serve",
      transformIndexHtml(html) {
        return html.replace(
          "connect-src 'self' ",
          "connect-src 'self' http://127.0.0.1:9000 http://127.0.0.1:9099 ws://127.0.0.1:9000 ",
        );
      },
    },
  ],
  build: {
    target: "es2022",
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
        },
      },
    },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts"],
      exclude: ["src/lib/firebase.ts", "src/lib/share.ts", "src/lib/**/*.test.ts", "src/lib/__tests__/**"],
      reporter: ["text", "html"],
    },
  },
});
