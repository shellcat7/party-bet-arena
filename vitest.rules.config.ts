import { defineConfig } from "vitest/config";

/** Realtime Database security rules tests. Run inside `firebase emulators:exec` (see package.json). */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
