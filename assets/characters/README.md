# Character art

Game-ready character sprites are organized by character and also packed into a shared atlas.

## Layout

- `batter/swing-01.png` through `batter/swing-08.png`: transparent batter swing frames with gold-rim aviator sunglasses and a black short-sleeve shirt, in playback order.
- `flyer/fly.png`: normal forward-flight pose in the reference gray flight suit.
- `flyer/lantern.png`: gray-suited character hanging below a Kongming lantern.
- `flyer/belly-slide.png`: belly-sliding pose with the source ground line removed.
- `flyer/headfirst-fall.png`: initial head-first falling pose.
- `flyer/jet.png`: approved sixth-generation jet transformation sprite.
- `flyer/ufo.png` and `flyer/ufo-lights-on.png`: approved, aligned UFO transformation frames with rim lights off/on for runtime blinking.
- `pickups/ufo.png`: approved minimal UFO pickup icon.
- `flyer/slingshot-seated.png`: gray-suited flyer seated in the slingshot pouch; the pouch itself is drawn at runtime.
- `launchers/slingshot.png`: complete settings-card icon.
- `launchers/slingshot-frame.png`: rigid in-game fork without bands or pouch; elastic parts are drawn by Canvas.
- `launchers/human-cannon.png`: empty human-cannon sprite used after launch and on the settings card.
- `launchers/human-cannon-loaded-v1.png`: approved side-view human-cannon loading pose used while waiting and choosing power.
- `launchers/missile-truck.png`: empty side-view missile truck used after launch and by the settings card.
- `launchers/missile-truck-loaded-review-v1.png`: approved loaded missile-truck sprite with the normal airborne flyer lying flush along the upper launch rail.
- `obstacles/mine.png`: approved side-view land-mine obstacle sprite.
- `atlas/characters.png` and `atlas/characters.json`: packed RGBA atlas and frame metadata.
- `atlas/characters-preview.png`: review contact sheet on a sky-blue background; not intended for runtime use.
- `source/flyer-gray-chroma/`: generated chroma-key masters.
- `source/flyer-gray-transparent/`: background-removed generated masters.
- `source/flyer-gray-final/`: game-ready masters conformed to the legacy canvases.
- `source/flyer-legacy/`: preserved pre-replacement flyer sprites used for size and review checks.
- `source/batter-black-chroma/`: generated batter chroma-key masters.
- `source/batter-black-transparent/`: background-removed batter masters.
- `source/batter-black-final/`: game-ready batter masters conformed to the legacy canvases.
- `source/batter-legacy/`: preserved pre-replacement batter frames used for size and review checks.
- `source/`: preserved source images and the original batter atlas metadata.
- `../concepts/ufo-lights-off-review-v1.png`, `../concepts/ufo-lights-on-review-v1.png`, and `../concepts/ufo-pickup-review-v3.png`: approved UFO review masters used by the atlas organizer. The approved beam master remains a style reference because runtime beam height is computed from the UFO-to-ground distance.

All runtime PNG files use straight RGBA transparency and retain padding around their visible bounds.

Run `tools/prepare_flyer_art.py` or `tools/prepare_batter_art.py` to reconform generated character art and rebuild its before/after review sheet. Then run `tools/organize_character_art.py` to regenerate the extracted sprites, UFO runtime assets, atlas, metadata, and preview.
