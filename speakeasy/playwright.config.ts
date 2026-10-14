import { defineConfig, devices } from "@playwright/test";

// Phase 0 safety net (docs/modernization-plan.md §5): the app against a fake
// backend. Since Phase 2 it is served from the Vite build output.
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 1280, height: 720 },
    locale: "en-US",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 720 } },
    },
  ],
  // Tests run against the built site (dist/), the same files Vercel serves.
  webServer: {
    command:
      "pnpm exec vite build && pnpm exec vite preview --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173/index.html",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
