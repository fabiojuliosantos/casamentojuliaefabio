#!/usr/bin/env python3
"""Create personalized PNG and clickable PDF invitations from a CSV guest list."""

from __future__ import annotations

import argparse
import csv
import shutil
import subprocess
from pathlib import Path

from create_clickable_invitation_pdf import build_pdf


CLICK_RECT = (14.0, 87.5, 48.5, 96.2)


def load_names(csv_path: Path) -> list[str]:
    with csv_path.open(encoding="utf-8-sig", newline="") as csv_file:
        rows = csv.DictReader(csv_file)
        if not rows.fieldnames or "ID" not in rows.fieldnames or "Nome" not in rows.fieldnames:
            raise ValueError("CSV must contain ID and Nome columns")

        names = [
            row["Nome"].strip()
            for row in rows
            if row.get("ID", "").strip() and row.get("Nome", "").strip()
        ]

    if not names:
        raise ValueError("no guests found")
    if len(set(names)) != len(names):
        raise ValueError("guest names must be unique to become filenames")
    if any(any(char in name for char in ("/", "\\", "\0")) for name in names):
        raise ValueError("guest names contain characters that cannot be used in filenames")
    return names


def render_png(
    template: Path,
    font: Path,
    name: str,
    output: Path,
) -> None:
    subprocess.run(
        [
            "magick",
            str(template),
            "-font",
            str(font),
            "-fill",
            "#A65B12",
            "-pointsize",
            "50",
            "-gravity",
            "North",
            "-annotate",
            "-282+790",
            f"Convidado(a): {name}",
            str(output),
        ],
        check=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("csv", type=Path)
    parser.add_argument("template", type=Path)
    parser.add_argument("font", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--url", required=True)
    args = parser.parse_args()

    if shutil.which("magick") is None:
        raise RuntimeError("ImageMagick command 'magick' was not found")

    names = load_names(args.csv)
    args.output_dir.mkdir(parents=True, exist_ok=True)

    for index, name in enumerate(names, start=1):
        png_path = args.output_dir / f"{name}.png"
        pdf_path = args.output_dir / f"{name}.pdf"

        render_png(args.template, args.font, name, png_path)
        build_pdf(
            png_path,
            pdf_path,
            args.url,
            CLICK_RECT,
            f"Convite de casamento - {name}",
        )

        print(f"[{index:03d}/{len(names):03d}] {name}", flush=True)


if __name__ == "__main__":
    main()
