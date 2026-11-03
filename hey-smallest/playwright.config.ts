import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 40_000,
  use: { baseURL: "http://127.0.0.1:3456" },
  webServer: {
    command: "npm run dev -- --port 3456",
    url: "http://127.0.0.1:3456",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
