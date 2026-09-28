import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["apps/*/src/**/*.test.ts", "packages/*/src/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      ...(process.env.RUN_DYNAMODB_TESTS ? [] : ["**/*.integration.test.ts"]),
    ],
    environment: "node",
    restoreMocks: true,
  },
});
