import { spawn } from "node:child_process";
const child = spawn(
  "pnpm",
  ["exec", "vitest", "run", "apps/api/src/storage/storage.integration.test.ts"],
  { stdio: "inherit", env: { ...process.env, RUN_DYNAMODB_TESTS: "1" } },
);
child.once("exit", (code) => process.exit(code ?? 1));
