import { defineConfig, devices } from "@playwright/test";

/**
 * Two projects:
 * - `local`: the production build served by `vite preview`, with Firebase disabled
 *   (demo and single-device rooms). Runs anywhere.
 * - `online`: the dev server wired to the Firebase Auth + Realtime Database emulators,
 *   exercising real multi-device sync. Run through `npm run test:e2e:online`.
 */
const online = process.argv.some((arg) => arg.includes("online"));
const localPort = 4173;
const onlinePort = 5174;

const emulatorEnv = {
  VITE_FIREBASE_API_KEY: "demo-key",
  VITE_FIREBASE_APP_ID: "1:123:web:123",
  VITE_FIREBASE_AUTH_DOMAIN: "demo-party-bet-security.firebaseapp.com",
  VITE_FIREBASE_DATABASE_URL: "https://demo-party-bet-security-default-rtdb.firebaseio.com",
  VITE_FIREBASE_PROJECT_ID: "demo-party-bet-security",
  VITE_USE_FIREBASE_EMULATORS: "true",
};

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    ...devices["iPhone 13"],
    browserName: "chromium",
    locale: "ja-JP",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "local",
      testIgnore: /online\.spec\.ts/,
      use: { baseURL: `http://127.0.0.1:${localPort}/party-bet-arena/` },
    },
    {
      name: "online",
      testMatch: /online\.spec\.ts/,
      use: { baseURL: `http://127.0.0.1:${onlinePort}/party-bet-arena/` },
    },
  ],
  webServer: online
    ? {
        command: `npx vite --port ${onlinePort} --strictPort --host 127.0.0.1`,
        url: `http://127.0.0.1:${onlinePort}/party-bet-arena/`,
        env: emulatorEnv,
        reuseExistingServer: !process.env.CI,
      }
    : {
        command: `npx vite build --configLoader runner --mode e2e && npx vite preview --port ${localPort} --strictPort --host 127.0.0.1`,
        url: `http://127.0.0.1:${localPort}/party-bet-arena/`,
        env: Object.fromEntries(Object.keys(emulatorEnv).map((key) => [key, ""])),
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
