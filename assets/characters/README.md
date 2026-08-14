# Character art

Game-ready character sprites are organized by character and also packed into a shared atlas.

## Layout

- `batter/swing-01.png` through `batter/swing-08.png`: transparent batter swing frames in playback order.
- `flyer/fly.png`: normal forward-flight pose.
- `flyer/lantern.png`: character hanging below a Kongming lantern.
- `flyer/belly-slide.png`: belly-sliding pose with the source ground line removed.
- `flyer/headfirst-fall.png`: initial head-first falling pose.
- `flyer/jet.png`: approved sixth-generation jet transformation sprite.
- `obstacles/mine.png`: approved side-view land-mine obstacle sprite.
- `atlas/characters.png` and `atlas/characters.json`: packed RGBA atlas and frame metadata.
- `atlas/characters-preview.png`: review contact sheet on a sky-blue background; not intended for runtime use.
- `source/`: preserved source images and the original batter atlas metadata.

All runtime PNG files use straight RGBA transparency and retain padding around their visible bounds.

Run `tools/organize_character_art.py` with the workspace Python runtime to regenerate the extracted sprites, atlas, metadata, and preview.
