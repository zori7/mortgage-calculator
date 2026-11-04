import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Env lives in the repo-root .env (written by scripts/dev-env.sh), shared with the API.
const envDir = "../..";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, "");
  return {
    envDir,
    plugins: [react()],
    server: {
      port: Number(env.WEB_PORT ?? 5173),
      strictPort: true, // fail loudly instead of drifting onto another worktree's port
      host: true,
    },
  };
});
