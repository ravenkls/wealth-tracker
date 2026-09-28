import { build } from "esbuild";
import { mkdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
const output = new URL("../../.build/lambda/", import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await build({
  entryPoints: ["src/production/handler.ts"],
  outfile: new URL("index.cjs", output).pathname,
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  minify: true,
  sourcemap: false,
});
execFileSync("zip", ["-q", "../lambda.zip", "index.cjs"], { cwd: output });
