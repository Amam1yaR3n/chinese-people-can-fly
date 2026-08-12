import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [
    {
      name: "copy-offline-game",
      apply: "build",
      closeBundle() {
        const targetDirectory = resolve(import.meta.dirname, "dist/offline");
        mkdirSync(targetDirectory, { recursive: true });
        copyFileSync(
          resolve(import.meta.dirname, "offline/game.js"),
          resolve(targetDirectory, "game.js"),
        );
      },
    },
  ],
});
