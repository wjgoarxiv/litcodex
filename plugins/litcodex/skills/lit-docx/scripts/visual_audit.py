#!/usr/bin/env python3
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Render a quick visual audit snapshot for DOCX/PDF artifacts")
    parser.add_argument("input", help="Input DOCX or PDF")
    parser.add_argument("--out-dir", required=True, help="Directory for rendered artifacts")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    source = Path(args.input).expanduser().resolve()
    out_dir = Path(args.out_dir).expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    soffice = shutil.which("soffice")
    if not soffice:
        print("SKIP  LibreOffice/soffice not installed; visual audit unavailable")
        return 0
    result = subprocess.run(
        [soffice, "--headless", "--convert-to", "pdf", "--outdir", str(out_dir), str(source)],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(result.stdout)
        print(result.stderr, file=sys.stderr)
        return 1
    print(f"PASS  visual audit render complete -> {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
