import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: true,
    outDir: "offline",
    lib: {
      entry: resolve(import.meta.dirname, "src/main.ts"),
      name: "ChinesePeopleCanFly",
      formats: ["iife"],
      fileName: () => "game.js",
    },
  },
});
