from __future__ import annotations

from pathlib import Path
import struct


def build_ico(size: int = 32) -> bytes:
    width = size
    height = size
    xor_rows = bytearray()

    for y in range(height - 1, -1, -1):
        for x in range(width):
            on_badge = (x - width / 2) ** 2 + (y - height / 2) ** 2 <= (width * 0.4) ** 2
            if on_badge:
                blue = 0xC6
                green = 0x6A
                red = 0x22
                alpha = 0xFF
            else:
                blue = 0x00
                green = 0x00
                red = 0x00
                alpha = 0x00
            xor_rows.extend([blue, green, red, alpha])

    mask_row_bytes = ((width + 31) // 32) * 4
    and_mask = bytes(mask_row_bytes * height)

    header = struct.pack(
        "<IIIHHIIIIII",
        40,
        width,
        height * 2,
        1,
        32,
        0,
        len(xor_rows) + len(and_mask),
        0,
        0,
        0,
        0,
    )
    image = header + bytes(xor_rows) + and_mask

    icon_dir = struct.pack("<HHH", 0, 1, 1)
    entry = struct.pack(
        "<BBBBHHII",
        width if width < 256 else 0,
        height if height < 256 else 0,
        0,
        0,
        1,
        32,
        len(image),
        6 + 16,
    )
    return icon_dir + entry + image


def main() -> None:
    target = Path(__file__).resolve().parents[1] / "apps" / "desktop" / "src-tauri" / "icons" / "icon.ico"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(build_ico())


if __name__ == "__main__":
    main()
