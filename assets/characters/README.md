# Character art

Only game-ready assets and atlas metadata are kept here. Source generations,
chroma-key intermediates, legacy comparisons, and review images have been
removed.

## Runtime layout

- `atlas/characters.png`: packed RGBA sprites for the batter, flyer poses,
  transformations, mine, and UFO pickup.
- `atlas/characters.json`: atlas frame metadata used by verification tools.
- `batter/`, `flyer/`, `obstacles/`, and `pickups/`: game-ready component
  masters represented in the atlas. `batter/swing-01.png` is also used by the
  launcher card, and `flyer/slingshot-seated.png` is drawn independently.
- `launchers/`: launcher-card and in-game launcher sprites.

All PNG files use straight RGBA transparency and retain the padding required by
their runtime anchors.
