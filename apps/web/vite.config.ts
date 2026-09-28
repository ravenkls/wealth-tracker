import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
const envDir = fileURLToPath(new URL("../../", import.meta.url));
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, "");
  const port = Number(env.WEB_PORT ?? 5173);
  const apiPort = Number(env.API_PORT ?? 3001);
  for (const value of [port, apiPort]) {
    if (!Number.isInteger(value) || value < 1024 || value > 65535)
      throw new Error("Local ports must be integers between 1024 and 65535.");
  }
  return {
    plugins: [react()],
    envDir,
    server: {
      host: "127.0.0.1",
      port,
      strictPort: true,
      proxy: {
        "/api": { target: `http://127.0.0.1:${apiPort}` },
        "/auth": { target: `http://127.0.0.1:${apiPort}` },
      },
    },
  };
});
