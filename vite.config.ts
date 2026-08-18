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

        const batterDirectory = resolve(
          import.meta.dirname,
          "dist/assets/characters/batter",
        );
        mkdirSync(batterDirectory, { recursive: true });
        copyFileSync(
          resolve(
            import.meta.dirname,
            "assets/characters/batter/swing-01.png",
          ),
          resolve(batterDirectory, "swing-01.png"),
        );

        const launcherDirectory = resolve(
          import.meta.dirname,
          "dist/assets/characters/launchers",
        );
        mkdirSync(launcherDirectory, { recursive: true });
        for (const launcherFile of [
          "slingshot.png",
          "slingshot-frame.png",
          "human-cannon.png",
          "human-cannon-loaded-v1.png",
          "missile-truck.png",
          "missile-truck-loaded-review-v1.png",
        ]) {
          copyFileSync(
            resolve(
              import.meta.dirname,
              "assets/characters/launchers",
              launcherFile,
            ),
            resolve(launcherDirectory, launcherFile),
          );
        }

        const flyerDirectory = resolve(
          import.meta.dirname,
          "dist/assets/characters/flyer",
        );
        mkdirSync(flyerDirectory, { recursive: true });
        copyFileSync(
          resolve(
            import.meta.dirname,
            "assets/characters/flyer/slingshot-seated.png",
          ),
          resolve(flyerDirectory, "slingshot-seated.png"),
        );

        const effectDirectory = resolve(
          import.meta.dirname,
          "dist/assets/effects",
        );
        mkdirSync(effectDirectory, { recursive: true });
        for (const effectFile of [
          "impact-flash.png",
          "human-cannon-fuse-flame-1.png",
          "human-cannon-fuse-flame-2.png",
          "human-cannon-launch-smoke.png",
          "missile-player-tail-flame.png",
        ]) {
          copyFileSync(
            resolve(import.meta.dirname, "assets/effects", effectFile),
            resolve(effectDirectory, effectFile),
          );
        }

        const backgroundDirectory = resolve(
          import.meta.dirname,
          "dist/assets/backgrounds",
        );
        mkdirSync(backgroundDirectory, { recursive: true });
        for (const backgroundFile of [
          "far-atlas.png",
          "china-mountain-forest-midground.png",
          "ground-tile-v8.png",
        ]) {
          copyFileSync(
            resolve(
              import.meta.dirname,
              "assets/backgrounds",
              backgroundFile,
            ),
            resolve(backgroundDirectory, backgroundFile),
          );
        }

        const audioDirectory = resolve(import.meta.dirname, "dist/assets/audio");
        mkdirSync(audioDirectory, { recursive: true });
        for (const audioFile of [
          "bgm.m4a",
          "launch-hit.mp3",
          "batter-hit.mp3",
          "slingshot-release.mp3",
          "cannon-launch.mp3",
          "missile-launch.mp3",
          "ufo-pickup.mp3",
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
