import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const tlsKeyPath = process.env.CONNECTSPHERE_TLS_KEY;
const tlsCertPath = process.env.CONNECTSPHERE_TLS_CERT;

if (Boolean(tlsKeyPath) !== Boolean(tlsCertPath)) {
  throw new Error("Set both CONNECTSPHERE_TLS_KEY and CONNECTSPHERE_TLS_CERT to enable HTTPS.");
}

const https = tlsKeyPath && tlsCertPath
  ? {
      key: readFileSync(tlsKeyPath),
      cert: readFileSync(tlsCertPath),
    }
  : undefined;

export default defineConfig({
  root: "apps/web",
  plugins: [react()],
  server: {
    ...(https ? { https } : {}),
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3001",
        ws: true,
      },
      "/ws": {
        target: "ws://127.0.0.1:3001",
        ws: true,
      },
    },
  },
  preview: {
    ...(https ? { https } : {}),
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
