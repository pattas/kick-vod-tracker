from PIL import Image, ImageDraw

KICK_GREEN = (83, 252, 24, 255)
BG = (12, 12, 12, 255)


def make_icon(size: int, path: str) -> None:
    img = Image.new("RGBA", (size, size), BG)
    d = ImageDraw.Draw(img)

    # zaoblené pozadí
    r = max(2, size // 6)
    d.rounded_rectangle([(0, 0), (size - 1, size - 1)], radius=r, fill=BG)

    # play trojúhelník
    pad = size * 0.28
    tip = size * 0.78
    top = pad
    bottom = size - pad
    left = pad
    d.polygon(
        [(left, top), (left, bottom), (tip, size / 2)],
        fill=KICK_GREEN,
    )

    img.save(path, "PNG")


if __name__ == "__main__":
    for s in (16, 48, 128):
        make_icon(s, f"icons/icon{s}.png")
    print("done")
