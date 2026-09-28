#!/usr/bin/env python3
"""Read-only runtime and authored-payload availability probe."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import TypedDict


CORE_MODULES = ("matplotlib",)
OPTIONAL_MODULES = (
    "numpy",
    "seaborn",
    "pandas",
    "scipy",
    "plotly",
    "kaleido",
    "colorspacious",
    "MDAnalysis",
    "nglview",
    "py3Dmol",
    "PIL",
    "tifffile",
)
SOURCE_HASHES = {
    "SKILL.md": "d6084a7e3adf283157820ea20dbe1b46fa22fa1be17b138ab1203be550f4ef68",
    "assets/color_palettes.py": "ffea28da930406ecb11bbeaebfc530dfac40b772827a7653f449cb3b0bb35309",
    "assets/nature.mplstyle": "6a7343788bf772b7e1bc813d094f7bafa97c1e5544586e7b76002ad8547229b6",
    "assets/presentation.mplstyle": "e3ee23f0470d7fb07a0be75cd1210e231becfc2f5267aa404e4186aa077a3339",
    "assets/publication.mplstyle": "18447af3bc47310d23fc27255413c23d8bbe3ff441463cc54fcecdfacd205bea",
    "evals/evals.json": "366dc61b6e042f08f28bf33f2534feea80219d771b84497ec7094b30263e935b",
    "references/color_palettes.md": "0298691c8de8379570488a7b7768663971bc20af1fb05d464c5438d43a21dcfa",
    "references/journal_requirements.md": "56fdde590a9d778547dbcb609b77d86f1f31865e803bcecca5d8c4c72b91b3c7",
    "references/matplotlib_examples.md": "c99cd4f83e2452773e9580e2fa0984e61433c7a9b57ca0d2562dc400dfe4f83d",
    "references/mdanalysis_martini_visualization.md": "abcb3c61f1c3984ba9014d9ae197b726d23c1df844dc90988ecc4d8f0e349bfe",
    "references/publication_guidelines.md": "d9f5d0f115872c4c190a11d83432d44635e38ef9f1740db471fcc70f4c91dd2c",
    "references/seaborn_for_publications.md": "2da2147ae8974b4b5d16096c1484b982d5d1e5f91113808ebfd12111a0a6597a",
    "scripts/figure_export.py": "b22c7708afaf2a1cfa4f821eb9230d4262f1d52948af7f0815855aa9d0960403",
    "scripts/style_presets.py": "e9d450bd4ab6b11303b02d5029177c8d49466cc597648d12de0ecdb7620f64c4",
    "tests/test_figure_export.py": "b18414369e6721ad93d417914114d71af006248675eb20bb1f4989c48ec9a58e",
    "tests/test_style_presets.py": "ff0e190196480848f1fea2398220038771f386ee7967a0ef122b0dfbca3aed46",
}
APPROVED_SOURCE_MANIFEST = "b1b8f1bf8791daecdbb00dc70631cd955e72976664d302af0bc81e218b9cec3b"


class PreflightReport(TypedDict):
    status: str
    python: str
    sourceRoot: str
    scriptsRoot: str
    assetsRoot: str
    sourceManifest: str
    approvedSourceManifest: str
    sourcePayloadComplete: bool
    missingSource: list[str]
    unexpectedSource: list[str]
    hashMismatches: list[str]
    core: dict[str, bool]
    optional: dict[str, bool]
    missingOptional: list[str]
    helperImports: dict[str, bool]
    helperImportSkipped: list[str]
    helperImportErrors: dict[str, str]
    helperImportPolicy: str
    mutationPolicy: str


class HelperImportReport(TypedDict):
    imports: dict[str, bool]
    skipped: list[str]
    errors: dict[str, str]


def module_available(name: str) -> bool:
    return importlib.util.find_spec(name) is not None


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def import_helper(path: Path, module_name: str) -> str | None:
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        return f"no import loader for {path.name}"
    module = importlib.util.module_from_spec(spec)
    previous = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        spec.loader.exec_module(module)
    except Exception as error:  # noqa: BROAD_EXCEPT_OK - diagnostic import boundary
        return f"{type(error).__name__}: {error}"
    finally:
        sys.dont_write_bytecode = previous
    return None


def inspect_helper_imports(
    source_root: Path, matplotlib_available: bool, source_payload_complete: bool
) -> HelperImportReport:
    helper_paths = {
        "color_palettes": source_root / "assets" / "color_palettes.py",
        "style_presets": source_root / "scripts" / "style_presets.py",
        "figure_export": source_root / "scripts" / "figure_export.py",
    }
    imported = {name: False for name in helper_paths}
    skipped: list[str] = []
    errors: dict[str, str] = {}

    if not source_payload_complete:
        return {"imports": imported, "skipped": list(helper_paths), "errors": errors}

    palette_error = import_helper(helper_paths["color_palettes"], "litcodex_science_color_palettes")
    imported["color_palettes"] = palette_error is None
    if palette_error is not None:
        errors["color_palettes"] = palette_error

    if not matplotlib_available:
        skipped.extend(["style_presets", "figure_export"])
        return {"imports": imported, "skipped": skipped, "errors": errors}

    previous_mpl_config = os.environ.get("MPLCONFIGDIR")
    with tempfile.TemporaryDirectory(prefix="litcodex-science-mpl-") as mpl_config:
        os.environ["MPLCONFIGDIR"] = mpl_config
        for name in ("style_presets", "figure_export"):
            error = import_helper(helper_paths[name], f"litcodex_science_{name}")
            imported[name] = error is None
            if error is not None:
                errors[name] = error
    if previous_mpl_config is None:
        os.environ.pop("MPLCONFIGDIR", None)
    else:
        os.environ["MPLCONFIGDIR"] = previous_mpl_config
    return {"imports": imported, "skipped": skipped, "errors": errors}


def inspect_source(source_root: Path) -> tuple[list[str], list[str], list[str], str]:
    expected_paths = sorted(SOURCE_HASHES)
    actual_paths = sorted(
        path.relative_to(source_root).as_posix()
        for path in source_root.rglob("*")
        if path.is_file()
    )
    missing_source = sorted(set(expected_paths) - set(actual_paths))
    unexpected_source = sorted(set(actual_paths) - set(expected_paths))
    hash_mismatches: list[str] = []
    records: list[str] = []
    for relative_path in expected_paths:
        source_path = source_root / relative_path
        if not source_path.is_file():
            continue
        digest = sha256(source_path)
        records.append(f"{digest}  045_scientific-visualization/{relative_path}\n")
        if digest != SOURCE_HASHES[relative_path]:
            hash_mismatches.append(relative_path)
    manifest = hashlib.sha256("".join(records).encode()).hexdigest()
    return missing_source, unexpected_source, hash_mismatches, manifest


def build_report() -> PreflightReport:
    skill_root = Path(__file__).resolve().parent.parent
    source_root = skill_root.parent.parent / "vendor" / "scientific-visualization"
    core = {name: module_available(name) for name in CORE_MODULES}
    optional = {name: module_available(name) for name in OPTIONAL_MODULES}
    missing_source, unexpected_source, hash_mismatches, source_manifest = inspect_source(source_root)
    source_payload_complete = not missing_source and not unexpected_source and not hash_mismatches
    source_payload_complete = source_payload_complete and source_manifest == APPROVED_SOURCE_MANIFEST
    helper_report = inspect_helper_imports(source_root, core["matplotlib"], source_payload_complete)
    helper_imports = helper_report["imports"]
    helpers_ready = helper_imports["color_palettes"] and (
        not core["matplotlib"] or (helper_imports["style_presets"] and helper_imports["figure_export"])
    )
    status = "ready" if all(core.values()) and source_payload_complete and helpers_ready else "degraded"
    return {
        "status": status,
        "python": sys.version.split()[0],
        "sourceRoot": str(source_root),
        "scriptsRoot": str(source_root / "scripts"),
        "assetsRoot": str(source_root / "assets"),
        "sourceManifest": source_manifest,
        "approvedSourceManifest": APPROVED_SOURCE_MANIFEST,
        "sourcePayloadComplete": source_payload_complete,
        "missingSource": missing_source,
        "unexpectedSource": unexpected_source,
        "hashMismatches": hash_mismatches,
        "core": core,
        "optional": optional,
        "missingOptional": [name for name, available in optional.items() if not available],
        "helperImports": helper_imports,
        "helperImportSkipped": helper_report["skipped"],
        "helperImportErrors": helper_report["errors"],
        "helperImportPolicy": "palette imports independently; scripts import when matplotlib is available; bytecode disabled and temporary MPL cache removed",
        "mutationPolicy": "read-only; no automatic dependency installation",
    }


def render_text(report: PreflightReport) -> str:
    lines = [
        f"scientific-visualization preflight: {report['status']}",
        f"python: {report['python']}",
        f"source root: {report['sourceRoot']}",
        f"scripts root: {report['scriptsRoot']}",
        f"assets root: {report['assetsRoot']}",
        f"source payload complete: {report['sourcePayloadComplete']}",
        f"source manifest: {report['sourceManifest']}",
    ]
    lines.extend(f"core {name}: {'yes' if available else 'no'}" for name, available in report["core"].items())
    missing_optional = report["missingOptional"]
    lines.append(f"missing optional: {', '.join(missing_optional) if missing_optional else 'none'}")
    lines.extend(f"helper {name}: {'yes' if imported else 'no'}" for name, imported in report["helperImports"].items())
    lines.append(f"helper imports skipped: {', '.join(report['helperImportSkipped']) if report['helperImportSkipped'] else 'none'}")
    lines.append("No dependencies were installed or changed.")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="emit one JSON object")
    args = parser.parse_args()
    report = build_report()
    print(json.dumps(report, sort_keys=True) if args.json else render_text(report))
    return 0 if report["status"] == "ready" else 3


if __name__ == "__main__":
    raise SystemExit(main())
