#!/usr/bin/env python3
"""render_pages.py — render a .pptx (or a PDF) to PNG pages so the deck can be looked at.

LibreOffice converts the deck to PDF inside a private profile, so parallel runs never share a lock.
LibreOffice ignores the font parts a .pptx embeds, so the plain TrueType/OpenType files in
ppt/fonts/*.fntdata are first copied into that profile's font folder; the pages then show the faces
PowerPoint shows (Pretendard, A2Z, JetBrains Mono) even on a machine that does not have them
installed. pdftoppm (poppler) rasterises the PDF. Without soffice or pdftoppm the script says what
is missing and exits 0, and the caller must report that the visual pass did not happen.

Usage:
    python3 scripts/render_pages.py <file.pptx|file.pdf> --out-dir DIR [--pages N] [--dpi 110] [--json]

Writes DIR/<stem>.pdf and DIR/page-01.png ...; exit 1 when a conversion fails.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path


def profile_fonts(source: Path, profile: Path) -> list[Path]:
    """Copy the font files a .pptx embeds into the profile's user/fonts folder; return what was placed."""
    if source.suffix.lower() != ".pptx":
        return []
    placed = []
    try:
        with zipfile.ZipFile(source) as z:
            for name in z.namelist():
                if not (name.startswith("ppt/fonts/") and name.endswith(".fntdata")):
                    continue
                data = z.read(name)
                # Only a plain OpenType or TrueType file; an obfuscated or EOT part is left alone.
                kind = ".otf" if data[:4] == b"OTTO" else ".ttf" if data[:4] in (b"\x00\x01\x00\x00", b"true") else None
                if not kind:
                    continue
                target = profile / "user" / "fonts" / (Path(name).stem + kind)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
                placed.append(target)
    except zipfile.BadZipFile:
        return []
    return placed


def to_pdf(source: Path, out_dir: Path) -> tuple[Path | None, str]:
    if source.suffix.lower() == ".pdf":
        return source, "input is already a PDF"
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        return None, "LibreOffice (soffice) is not on PATH"
    with tempfile.TemporaryDirectory(prefix="litcodex-soffice-") as profile:
        profile_fonts(source, Path(profile))
        result = subprocess.run(
            [soffice, f"-env:UserInstallation={Path(profile).as_uri()}", "--headless", "--convert-to", "pdf",
             "--outdir", str(out_dir), str(source)],
            capture_output=True, text=True, timeout=300,
        )
    pdf = out_dir / f"{source.stem}.pdf"
    if result.returncode != 0 or not pdf.exists():
        raise RuntimeError(f"soffice conversion failed: {(result.stderr or result.stdout).strip()[-400:]}")
    return pdf, "converted with soffice"


def rasterise(pdf: Path, out_dir: Path, pages: int, dpi: int) -> list[Path]:
    tool = shutil.which("pdftoppm")
    if not tool:
        return []
    subprocess.run([tool, "-png", "-r", str(dpi), "-l", str(pages), str(pdf), str(out_dir / "page")],
                   check=True, capture_output=True, timeout=300)
    written = []
    # pdftoppm pads the page number to the width of the page count; normalise to page-NN.png.
    for path in sorted(out_dir.glob("page-*.png")):
        number = int(path.stem.split("-")[-1])
        target = out_dir / f"page-{number:02d}.png"
        if path != target:
            path.replace(target)
        written.append(target)
    return sorted(set(written))


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Render deck pages to PNG.")
    parser.add_argument("input", type=Path)
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--pages", type=int, default=5)
    parser.add_argument("--dpi", type=int, default=110)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    sys.dont_write_bytecode = True
    source = args.input.expanduser().resolve()
    out_dir = args.out_dir.expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    try:
        pdf, how = to_pdf(source, out_dir)
        pngs = rasterise(pdf, out_dir, args.pages, args.dpi) if pdf else []
    except (RuntimeError, subprocess.SubprocessError) as error:
        report = {"status": "fail", "input": str(source), "detail": str(error), "pages": []}
        print(json.dumps(report, ensure_ascii=False) if args.json else f"FAIL  {error}")
        return 1
    if pdf and not pngs:
        how += "; pdftoppm is not on PATH, so only the PDF was written"
    status = "rendered" if pngs else "skipped"
    report = {"status": status, "input": str(source), "detail": how, "pdf": str(pdf) if pdf else None,
              "pages": [str(p) for p in pngs]}
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    elif pngs:
        print(f"PASS  rendered {len(pngs)} page(s) -> {out_dir}")
    else:
        print(f"SKIP  {how}; visual pages were not rendered")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
