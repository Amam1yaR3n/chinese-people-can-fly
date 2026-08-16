from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "assets" / "characters" / "source"
LEGACY_DIR = SOURCE_DIR / "batter-legacy"
GENERATED_DIR = SOURCE_DIR / "batter-black-transparent"
FINAL_DIR = SOURCE_DIR / "batter-black-final"
BATTER_DIR = ROOT / "assets" / "characters" / "batter"
REVIEW_DIR = ROOT / "artifacts" / "batter-art-review"

FRAMES = tuple(f"swing-{index:02d}" for index in range(1, 9))


def visible_bbox(image: Image.Image, threshold: int = 16) -> tuple[int, int, int, int]:
    alpha = image.getchannel("A").point(lambda value: 255 if value > threshold else 0)
    bbox = alpha.getbbox()
    if bbox is None:
        raise ValueError("sprite contains no visible pixels")
    return bbox


def conform_to_legacy(name: str) -> Image.Image:
    legacy = Image.open(LEGACY_DIR / f"{name}.png").convert("RGBA")
    generated = Image.open(GENERATED_DIR / f"{name}.png").convert("RGBA")
    legacy_bbox = visible_bbox(legacy)
    generated_bbox = visible_bbox(generated)
    generated_subject = generated.crop(generated_bbox)
    target_size = (
        legacy_bbox[2] - legacy_bbox[0],
        legacy_bbox[3] - legacy_bbox[1],
    )
    generated_subject = generated_subject.resize(target_size, Image.Resampling.LANCZOS)
    conformed = Image.new("RGBA", legacy.size, (0, 0, 0, 0))
    conformed.alpha_composite(generated_subject, (legacy_bbox[0], legacy_bbox[1]))
    if conformed.size != legacy.size:
        raise AssertionError(f"{name}: output canvas changed")
    return conformed


def checkerboard(size: tuple[int, int], tile: int = 16) -> Image.Image:
    image = Image.new("RGB", size, (232, 242, 249))
    draw = ImageDraw.Draw(image)
    alternate = (210, 226, 238)
    for y in range(0, size[1], tile):
        for x in range(0, size[0], tile):
            if (x // tile + y // tile) % 2:
                draw.rectangle((x, y, x + tile - 1, y + tile - 1), fill=alternate)
    return image


def fit_for_review(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    subject = image.crop(visible_bbox(image))
    scale = min(size[0] / subject.width, size[1] / subject.height)
    return subject.resize(
        (max(1, round(subject.width * scale)), max(1, round(subject.height * scale))),
        Image.Resampling.LANCZOS,
    )


def make_comparison(updated: dict[str, Image.Image]) -> None:
    pose_width = 880
    column_width = pose_width // 2
    row_height = 560
    header_height = 74
    label_height = 38
    margin = 16
    sheet = Image.new(
        "RGB",
        (pose_width * 2, header_height + row_height * 4),
        (241, 247, 251),
    )
    draw = ImageDraw.Draw(sheet)
    header_font = ImageFont.load_default(size=22)
    label_font = ImageFont.load_default(size=18)
    for group in range(2):
        base_x = group * pose_width
        draw.text(
            (base_x + column_width // 2, 26),
            "ORIGINAL",
            fill=(15, 30, 54),
            font=header_font,
            anchor="ma",
        )
        draw.text(
            (base_x + column_width + column_width // 2, 26),
            "UPDATED",
            fill=(15, 30, 54),
            font=header_font,
            anchor="ma",
        )

    original_out = REVIEW_DIR / "original"
    updated_out = REVIEW_DIR / "updated"
    original_out.mkdir(parents=True, exist_ok=True)
    updated_out.mkdir(parents=True, exist_ok=True)

    for index, name in enumerate(FRAMES):
        row = index % 4
        group = index // 4
        base_x = group * pose_width
        row_y = header_height + row * row_height
        original = Image.open(LEGACY_DIR / f"{name}.png").convert("RGBA")
        current = updated[name]
        original.save(original_out / f"{name}.png", optimize=True)
        current.save(updated_out / f"{name}.png", optimize=True)
        draw.text(
            (base_x + pose_width // 2, row_y + 7),
            name,
            fill=(15, 30, 54),
            font=label_font,
            anchor="ma",
        )
        for column, sprite in enumerate((original, current)):
            panel = checkerboard(
                (column_width - margin * 2, row_height - label_height - margin * 2)
            )
            shown = fit_for_review(sprite, (panel.width - 24, panel.height - 24))
            panel.paste(
                shown,
                ((panel.width - shown.width) // 2, (panel.height - shown.height) // 2),
                shown,
            )
            sheet.paste(
                panel,
                (base_x + column * column_width + margin, row_y + label_height),
            )
        draw.line(
            (base_x, row_y, base_x + pose_width, row_y),
            fill=(190, 207, 220),
            width=2,
        )

    REVIEW_DIR.mkdir(parents=True, exist_ok=True)
    sheet.save(REVIEW_DIR / "batter-art-before-after.png", optimize=True)


def main() -> None:
    FINAL_DIR.mkdir(parents=True, exist_ok=True)
    BATTER_DIR.mkdir(parents=True, exist_ok=True)
    updated: dict[str, Image.Image] = {}
    for name in FRAMES:
        image = conform_to_legacy(name)
        image.save(FINAL_DIR / f"{name}.png", optimize=True)
        image.save(BATTER_DIR / f"{name}.png", optimize=True)
        updated[name] = image
    make_comparison(updated)
    print(f"prepared {len(updated)} batter frames with legacy canvas sizes")


if __name__ == "__main__":
    main()
