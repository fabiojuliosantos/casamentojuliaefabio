#!/usr/bin/env python3
"""Create a one-page invitation PDF with a clickable RSVP area."""

from __future__ import annotations

import argparse
import io
from pathlib import Path

from PIL import Image


POINTS_PER_MM = 72 / 25.4


def parse_rect(value: str) -> tuple[float, float, float, float]:
    try:
        left, top, right, bottom = (float(part) for part in value.split(","))
    except ValueError as exc:
        raise argparse.ArgumentTypeError(
            "use left,top,right,bottom as percentages"
        ) from exc

    if not (0 <= left < right <= 100 and 0 <= top < bottom <= 100):
        raise argparse.ArgumentTypeError("rectangle percentages must be within 0..100")
    return left, top, right, bottom


def pdf_string(value: str) -> bytes:
    escaped = value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    return escaped.encode("utf-8")


def stream_object(dictionary: bytes, stream: bytes) -> bytes:
    return dictionary + b"\nstream\n" + stream + b"\nendstream"


def build_pdf(
    image_path: Path,
    output_path: Path,
    url: str,
    rect: tuple[float, float, float, float],
    title: str,
) -> None:
    with Image.open(image_path) as source:
        image = source.convert("RGB")
        image_width, image_height = image.size
        jpeg_buffer = io.BytesIO()
        image.save(jpeg_buffer, format="JPEG", quality=96, subsampling=0, optimize=True)
        jpeg_data = jpeg_buffer.getvalue()

    page_width = 210 * POINTS_PER_MM
    page_height = page_width * image_height / image_width

    left, top, right, bottom = rect
    link_rect = (
        page_width * left / 100,
        page_height * (100 - bottom) / 100,
        page_width * right / 100,
        page_height * (100 - top) / 100,
    )

    drawing = (
        f"q\n{page_width:.4f} 0 0 {page_height:.4f} 0 0 cm\n/Im0 Do\nQ\n"
    ).encode("ascii")

    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (
            b"<< /Type /Page /Parent 2 0 R "
            + f"/MediaBox [0 0 {page_width:.4f} {page_height:.4f}] ".encode("ascii")
            + b"/Resources << /XObject << /Im0 4 0 R >> >> "
            + b"/Contents 5 0 R /Annots [6 0 R] >>"
        ),
        stream_object(
            (
                b"<< /Type /XObject /Subtype /Image "
                + f"/Width {image_width} /Height {image_height} ".encode("ascii")
                + b"/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode "
                + f"/Length {len(jpeg_data)} >>".encode("ascii")
            ),
            jpeg_data,
        ),
        stream_object(f"<< /Length {len(drawing)} >>".encode("ascii"), drawing),
        (
            b"<< /Type /Annot /Subtype /Link "
            + (
                "/Rect [{:.4f} {:.4f} {:.4f} {:.4f}] ".format(*link_rect)
            ).encode("ascii")
            + b"/Border [0 0 0] /A << /S /URI /URI ("
            + pdf_string(url)
            + b") >> >>"
        ),
        b"<< /Title (" + pdf_string(title) + b") /Producer (Convite Julia e Fabio) >>",
    ]

    pdf = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for number, obj in enumerate(objects, start=1):
        offsets.append(len(pdf))
        pdf.extend(f"{number} 0 obj\n".encode("ascii"))
        pdf.extend(obj)
        pdf.extend(b"\nendobj\n")

    xref_offset = len(pdf)
    pdf.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    pdf.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        pdf.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    pdf.extend(
        (
            f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R /Info 7 0 R >>\n"
            f"startxref\n{xref_offset}\n%%EOF\n"
        ).encode("ascii")
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(pdf)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("image", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--url", required=True)
    parser.add_argument(
        "--rect",
        type=parse_rect,
        default=(14.0, 87.5, 48.5, 96.2),
        help="click area percentages: left,top,right,bottom",
    )
    parser.add_argument("--title", default="Convite de casamento")
    args = parser.parse_args()

    build_pdf(args.image, args.output, args.url, args.rect, args.title)


if __name__ == "__main__":
    main()
