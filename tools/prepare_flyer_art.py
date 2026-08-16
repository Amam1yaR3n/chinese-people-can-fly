from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "assets" / "characters" / "source"
LEGACY_DIR = SOURCE_DIR / "flyer-legacy"
GENERATED_DIR = SOURCE_DIR / "flyer-gray-transparent"
FINAL_DIR = SOURCE_DIR / "flyer-gray-final"
FLYER_DIR = ROOT / "assets" / "characters" / "flyer"
REVIEW_DIR = ROOT / "artifacts" / "flyer-art-review"

POSES = (
    "fly",
    "lantern",
    "belly-slide",
    "headfirst-fall",
    "slingshot-seated",
)


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
    target_width = legacy_bbox[2] - legacy_bbox[0]
    target_height = legacy_bbox[3] - legacy_bbox[1]
    generated_subject = generated_subject.resize(
        (target_width, target_height),
        Image.Resampling.LANCZOS,
    )

    conformed = Image.new("RGBA", legacy.size, (0, 0, 0, 0))
    conformed.alpha_composite(generated_subject, (legacy_bbox[0], legacy_bbox[1]))

    if name == "lantern":
        # The lantern is not part of the requested wardrobe change. Restore its
        # original pixels exactly while retaining the new gloved hands below it.
        preserve_rows = 306
        clear = Image.new("RGBA", (legacy.width, preserve_rows), (0, 0, 0, 0))
        conformed.paste(clear, (0, 0))
        conformed.alpha_composite(legacy.crop((0, 0, legacy.width, preserve_rows)), (0, 0))

    if conformed.size != legacy.size:
        raise AssertionError(f"{name}: output canvas changed")
    conformed_bbox = visible_bbox(conformed)
    bounds_delta = tuple(
        abs(current - original)
        for current, original in zip(conformed_bbox, legacy_bbox, strict=True)
    )
    if max(bounds_delta) > 16:
        raise AssertionError(
            f"{name}: visible bounds changed from {legacy_bbox} to {conformed_bbox}"
        )
    return conformed


def checkerboard(size: tuple[int, int], tile: int = 18) -> Image.Image:
    image = Image.new("RGB", size, (232, 242, 249))
    draw = ImageDraw.Draw(image)
    alternate = (210, 226, 238)
    for y in range(0, size[1], tile):
        for x in range(0, size[0], tile):
            if (x // tile + y // tile) % 2:
                draw.rectangle((x, y, x + tile - 1, y + tile - 1), fill=alternate)
    return image


def fit_for_review(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    bbox = visible_bbox(image)
    subject = image.crop(bbox)
    scale = min(size[0] / subject.width, size[1] / subject.height)
    shown = subject.resize(
        (max(1, round(subject.width * scale)), max(1, round(subject.height * scale))),
        Image.Resampling.LANCZOS,
    )
    return shown


def make_comparison(updated: dict[str, Image.Image]) -> None:
    cell_width = 760
    row_height = 500
    header_height = 90
    label_height = 42
    margin = 24
    sheet = Image.new(
        "RGB",
        (cell_width * 2, header_height + row_height * len(POSES)),
        (241, 247, 251),
    )
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default(size=24)
    label_font = ImageFont.load_default(size=20)
    draw.text((cell_width // 2, 30), "ORIGINAL", fill=(15, 30, 54), font=font, anchor="ma")
    draw.text((cell_width + cell_width // 2, 30), "UPDATED", fill=(15, 30, 54), font=font, anchor="ma")

    original_out = REVIEW_DIR / "original"
    updated_out = REVIEW_DIR / "updated"
    original_out.mkdir(parents=True, exist_ok=True)
    updated_out.mkdir(parents=True, exist_ok=True)

    for index, name in enumerate(POSES):
        original = Image.open(LEGACY_DIR / f"{name}.png").convert("RGBA")
        current = updated[name]
        original.save(original_out / f"{name}.png", optimize=True)
        current.save(updated_out / f"{name}.png", optimize=True)
        row_y = header_height + index * row_height
        for column, sprite in enumerate((original, current)):
            panel = checkerboard((cell_width - margin * 2, row_height - label_height - margin * 2))
            shown = fit_for_review(sprite, (panel.width - 30, panel.height - 30))
            panel.paste(
                shown,
                ((panel.width - shown.width) // 2, (panel.height - shown.height) // 2),
                shown,
            )
            sheet.paste(panel, (column * cell_width + margin, row_y + label_height))
        draw.text(
            (cell_width, row_y + 8),
            name,
            fill=(15, 30, 54),
            font=label_font,
            anchor="ma",
        )
        draw.line((0, row_y, cell_width * 2, row_y), fill=(190, 207, 220), width=2)

    REVIEW_DIR.mkdir(parents=True, exist_ok=True)
    sheet.save(REVIEW_DIR / "flyer-art-before-after.png", optimize=True)


def main() -> None:
    FINAL_DIR.mkdir(parents=True, exist_ok=True)
    FLYER_DIR.mkdir(parents=True, exist_ok=True)
    updated: dict[str, Image.Image] = {}
    for name in POSES:
        image = conform_to_legacy(name)
        image.save(FINAL_DIR / f"{name}.png", optimize=True)
        image.save(FLYER_DIR / f"{name}.png", optimize=True)
        updated[name] = image
    make_comparison(updated)
    print(f"prepared {len(updated)} flyer sprites with legacy canvas sizes and bounds")


if __name__ == "__main__":
    main()
