import { defineConfig } from "vitest/config";

// Unit tests for the pure logic (docs/modernization-plan.md §5.4 P0-18).
// They import the legacy JS modules directly, so a later TypeScript port
// has to keep passing them.
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
