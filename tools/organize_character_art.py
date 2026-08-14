from __future__ import annotations

import json
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "assets" / "characters" / "source"
BATTER_DIR = ROOT / "assets" / "characters" / "batter"
FLYER_DIR = ROOT / "assets" / "characters" / "flyer"
OBSTACLE_DIR = ROOT / "assets" / "characters" / "obstacles"
ATLAS_DIR = ROOT / "assets" / "characters" / "atlas"

BATTER_SHEET = SOURCE_DIR / "batter-spritesheet-original.png"
BATTER_DATA = SOURCE_DIR / "batter-spritesheet-original.json"
FLYER_FLIGHT = SOURCE_DIR / "flyer-flight-original.png"
FLYER_POSES = SOURCE_DIR / "flyer-poses-chroma.png"
SIXTH_GEN_JET = SOURCE_DIR / "sixth-gen-jet-original.png"
MINE_SOURCE = SOURCE_DIR / "mine-original.png"


def connected_background_mask(rgb: np.ndarray, seeds: list[tuple[int, int]], threshold: float) -> np.ndarray:
    height, width = rgb.shape[:2]
    seed_colors = np.array([rgb[y, x].astype(np.float32) for x, y in seeds])
    pixels = rgb.astype(np.float32)
    distances = np.min(
        np.sqrt(np.sum((pixels[:, :, None, :] - seed_colors[None, None, :, :]) ** 2, axis=3)),
        axis=2,
    )
    candidates = distances <= threshold
    visited = np.zeros((height, width), dtype=bool)
    queue: deque[tuple[int, int]] = deque()
    for x, y in seeds:
        if candidates[y, x] and not visited[y, x]:
            visited[y, x] = True
            queue.append((x, y))
    while queue:
        x, y = queue.popleft()
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < width and 0 <= ny < height and candidates[ny, nx] and not visited[ny, nx]:
                visited[ny, nx] = True
                queue.append((nx, ny))
    return visited


def make_transparent(
    source: Path,
    *,
    threshold: float,
    crop_boxes: list[tuple[int, int, int, int]],
    remove_dominant_green: bool = False,
) -> list[Image.Image]:
    image = Image.open(source).convert("RGBA")
    rgba = np.array(image)
    rgb = rgba[:, :, :3]
    width, height = image.size
    seeds = [(0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)]
    background = connected_background_mask(rgb, seeds, threshold)
    if remove_dominant_green:
        channels = rgb.astype(np.int16)
        green_dominance = channels[:, :, 1] - np.maximum(channels[:, :, 0], channels[:, :, 2])
        chroma_green = (channels[:, :, 1] >= 175) & (green_dominance >= 65)
        background |= chroma_green

    # Feather only the outside edge; opaque interiors remain untouched.
    alpha = np.where(background, 0, 255).astype(np.uint8)
    for _ in range(2):
        neighbors = np.minimum.reduce(
            [
                alpha,
                np.roll(alpha, 1, axis=0),
                np.roll(alpha, -1, axis=0),
                np.roll(alpha, 1, axis=1),
                np.roll(alpha, -1, axis=1),
            ]
        )
        edge = (alpha == 255) & (neighbors == 0)
        alpha[edge] = 160
    rgba[:, :, 3] = alpha
    if remove_dominant_green:
        # Suppress the green spill in partially transparent antialiased edge pixels.
        partial = (alpha > 0) & (alpha < 255)
        edge_rgb = rgba[:, :, :3].astype(np.int16)
        neutral_cap = np.maximum(edge_rgb[:, :, 0], edge_rgb[:, :, 2])
        edge_rgb[:, :, 1] = np.where(partial, np.minimum(edge_rgb[:, :, 1], neutral_cap), edge_rgb[:, :, 1])
        rgba[:, :, :3] = np.clip(edge_rgb, 0, 255).astype(np.uint8)
    transparent = Image.fromarray(rgba, "RGBA")
    return [transparent.crop(box) for box in crop_boxes]


def keep_components(image: Image.Image, *, minimum_area: int, x_range: tuple[int, int] | None = None) -> Image.Image:
    rgba = np.array(image)
    visible = rgba[:, :, 3] > 24
    height, width = visible.shape
    visited = np.zeros_like(visible)
    keep = np.zeros_like(visible)
    for y in range(height):
        for x in range(width):
            if not visible[y, x] or visited[y, x]:
                continue
            queue: deque[tuple[int, int]] = deque([(x, y)])
            visited[y, x] = True
            points: list[tuple[int, int]] = []
            while queue:
                px, py = queue.popleft()
                points.append((px, py))
                for nx, ny in ((px - 1, py), (px + 1, py), (px, py - 1), (px, py + 1)):
                    if 0 <= nx < width and 0 <= ny < height and visible[ny, nx] and not visited[ny, nx]:
                        visited[ny, nx] = True
                        queue.append((nx, ny))
            if len(points) < minimum_area:
                continue
            center_x = sum(px for px, _ in points) / len(points)
            if x_range is not None and not (x_range[0] <= center_x < x_range[1]):
                continue
            for px, py in points:
                keep[py, px] = True
    rgba[~keep, 3] = 0
    return Image.fromarray(rgba, "RGBA")


def trim(image: Image.Image, padding: int = 12) -> Image.Image:
    bbox = image.getchannel("A").getbbox()
    if bbox is None:
        raise ValueError("sprite contains no visible pixels")
    left, top, right, bottom = bbox
    left = max(0, left - padding)
    top = max(0, top - padding)
    right = min(image.width, right + padding)
    bottom = min(image.height, bottom + padding)
    return image.crop((left, top, right, bottom))


def save_sprite(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    trim(image).save(path, optimize=True)


def extract_batter() -> list[tuple[str, Image.Image]]:
    data = json.loads(BATTER_DATA.read_text(encoding="utf-8"))
    sheet = Image.open(BATTER_SHEET).convert("RGBA")
    sprites: list[tuple[str, Image.Image]] = []
    for index, frame_data in enumerate(data["frames"].values(), start=1):
        frame = frame_data["frame"]
        sprite = sheet.crop((frame["x"], frame["y"], frame["x"] + frame["w"], frame["y"] + frame["h"]))
        name = f"swing-{index:02d}"
        save_sprite(sprite, BATTER_DIR / f"{name}.png")
        sprites.append((f"batter/{name}", trim(sprite)))
    return sprites


def extract_flyer() -> list[tuple[str, Image.Image]]:
    flight = make_transparent(
        FLYER_FLIGHT,
        threshold=38,
        crop_boxes=[(0, 0, Image.open(FLYER_FLIGHT).width, Image.open(FLYER_FLIGHT).height)],
    )[0]
    pose_source = Image.open(FLYER_POSES)
    width, height = pose_source.size
    transparent_sheet = make_transparent(
        FLYER_POSES,
        threshold=72,
        crop_boxes=[(0, 0, width, height)],
        remove_dominant_green=True,
    )[0]
    poses = []
    ranges = [(0, width // 3), (width // 3, 2 * width // 3), (2 * width // 3, width)]
    for x_range in ranges:
        # Isolate by component centroid on the full sheet, then trim its full bounds.
        # This preserves limbs that extend across a conceptual third boundary.
        isolated = keep_components(transparent_sheet, minimum_area=900, x_range=x_range)
        poses.append(isolated)
    jet = Image.open(SIXTH_GEN_JET).convert("RGBA")
    named = [
        ("fly", flight),
        ("lantern", poses[0]),
        ("belly-slide", poses[1]),
        ("headfirst-fall", poses[2]),
        ("jet", jet),
    ]
    sprites: list[tuple[str, Image.Image]] = []
    for name, sprite in named:
        save_sprite(sprite, FLYER_DIR / f"{name}.png")
        sprites.append((f"flyer/{name}", trim(sprite)))
    return sprites


def extract_obstacles() -> list[tuple[str, Image.Image]]:
    mine = Image.open(MINE_SOURCE).convert("RGBA")
    save_sprite(mine, OBSTACLE_DIR / "mine.png")
    return [("obstacles/mine", trim(mine))]


def pack_shelf(sprites: list[tuple[str, Image.Image]], max_width: int = 2048, padding: int = 8) -> dict:
    placements: list[tuple[str, Image.Image, int, int]] = []
    x = padding
    y = padding
    row_height = 0
    used_width = 0
    for name, image in sprites:
        if x + image.width + padding > max_width and x > padding:
            x = padding
            y += row_height + padding
            row_height = 0
        placements.append((name, image, x, y))
        x += image.width + padding
        row_height = max(row_height, image.height)
        used_width = max(used_width, x)
    atlas_width = min(max_width, max(1, used_width))
    atlas_height = y + row_height + padding
    atlas = Image.new("RGBA", (atlas_width, atlas_height), (0, 0, 0, 0))
    frames: dict[str, dict] = {}
    for name, image, px, py in placements:
        atlas.alpha_composite(image, (px, py))
        frames[name] = {
            "frame": {"x": px, "y": py, "w": image.width, "h": image.height},
            "rotated": False,
            "trimmed": True,
            "sourceSize": {"w": image.width, "h": image.height},
            "pivot": {"x": 0.5, "y": 0.5},
        }
    ATLAS_DIR.mkdir(parents=True, exist_ok=True)
    atlas.save(ATLAS_DIR / "characters.png", optimize=True)
    metadata = {
        "frames": frames,
        "meta": {
            "app": "tools/organize_character_art.py",
            "image": "characters.png",
            "format": "RGBA8888",
            "size": {"w": atlas_width, "h": atlas_height},
            "scale": "1",
        },
        "animations": {
            "batterSwing": [f"batter/swing-{index:02d}" for index in range(1, 9)],
            "flyer": {
                "airborne": "flyer/fly",
                "lantern": "flyer/lantern",
                "sliding": "flyer/belly-slide",
                "falling": "flyer/headfirst-fall",
                "jet": "flyer/jet",
            },
            "obstacles": {
                "mine": "obstacles/mine",
            },
        },
    }
    (ATLAS_DIR / "characters.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    return metadata


def make_preview(sprites: list[tuple[str, Image.Image]]) -> None:
    thumb_w, thumb_h = 300, 260
    columns = 4
    rows = (len(sprites) + columns - 1) // columns
    preview = Image.new("RGB", (columns * thumb_w, rows * thumb_h), (184, 226, 251))
    draw = ImageDraw.Draw(preview)
    for index, (name, image) in enumerate(sprites):
        x = (index % columns) * thumb_w
        y = (index // columns) * thumb_h
        available = (thumb_w - 28, thumb_h - 44)
        scale = min(available[0] / image.width, available[1] / image.height, 1.0)
        shown = image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))), Image.Resampling.LANCZOS)
        preview.paste(shown, (x + (thumb_w - shown.width) // 2, y + 8), shown)
        draw.text((x + 10, y + thumb_h - 26), name, fill=(10, 24, 52))
    preview.save(ATLAS_DIR / "characters-preview.png", optimize=True)


def main() -> None:
    for directory in (BATTER_DIR, FLYER_DIR, OBSTACLE_DIR, ATLAS_DIR):
        directory.mkdir(parents=True, exist_ok=True)
    sprites = extract_batter() + extract_flyer() + extract_obstacles()
    metadata = pack_shelf(sprites)
    make_preview(sprites)
    print(f"organized {len(sprites)} sprites into {metadata['meta']['size']}")


if __name__ == "__main__":
    main()
