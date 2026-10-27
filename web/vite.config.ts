import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: __dirname,
  plugins: [react(), tailwindcss()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    // Point the dev server at a running Worker: API_ORIGIN=http://localhost:8792 npm run dev:web
    proxy: {
      "/api": process.env.API_ORIGIN ?? "http://localhost:8787",
      "/telegram": process.env.API_ORIGIN ?? "http://localhost:8787",
    },
  },
});
