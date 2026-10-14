import { defineConfig, devices } from "@playwright/test";

// Phase 0 safety net (docs/modernization-plan.md §5): the current app,
// served as plain static files with caching off, against a fake backend.
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
  webServer: {
    command: "pnpm exec http-server . -p 4173 -c-1 --silent",
    url: "http://127.0.0.1:4173/index.html",
    reuseExistingServer: !process.env.CI,
  },
});
