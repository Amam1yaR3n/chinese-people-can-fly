from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "concepts" / "impact-flash-review-v1.png"
REVIEW_OUTPUT = ROOT / "assets" / "concepts" / "impact-flash-review-v2.png"
RUNTIME_OUTPUT = ROOT / "assets" / "effects" / "impact-flash.png"

WIDTH_SCALE = 0.72
RUNTIME_SIZE = 256


def narrow(image: Image.Image, output_size: int) -> Image.Image:
    source = image.convert("RGBA")
    target_width = round(output_size * WIDTH_SCALE)
    resized = source.resize(
        (target_width, output_size),
        Image.Resampling.LANCZOS,
    )
    output = Image.new("RGBA", (output_size, output_size), (0, 0, 0, 0))
    output.alpha_composite(resized, ((output_size - target_width) // 2, 0))
    return output


def main() -> None:
    with Image.open(SOURCE) as source:
        source = source.convert("RGBA")
        review = narrow(source, source.height)
        runtime = narrow(source, RUNTIME_SIZE)

    REVIEW_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    RUNTIME_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    review.save(REVIEW_OUTPUT, optimize=True)
    runtime.save(RUNTIME_OUTPUT, optimize=True)
    print(f"wrote {REVIEW_OUTPUT.relative_to(ROOT)}")
    print(f"wrote {RUNTIME_OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
