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

        const atlasDirectory = resolve(
          import.meta.dirname,
          "dist/assets/characters/atlas",
        );
        mkdirSync(atlasDirectory, { recursive: true });
        copyFileSync(
          resolve(
            import.meta.dirname,
            "assets/characters/atlas/characters.png",
          ),
          resolve(atlasDirectory, "characters.png"),
        );

        const audioDirectory = resolve(import.meta.dirname, "dist/assets/audio");
        mkdirSync(audioDirectory, { recursive: true });
        for (const audioFile of [
          "bgm.m4a",
          "launch-hit.mp3",
          "sky-lantern-pickup.mp3",
          "sixth-gen-jet-pickup.mp3",
          "mine-trigger.mp3",
          "water-skip.mp3",
          "red-packet-pickup.mp3",
        ]) {
          copyFileSync(
            resolve(import.meta.dirname, "assets/audio", audioFile),
            resolve(audioDirectory, audioFile),
          );
        }
      },
    },
  ],
});
