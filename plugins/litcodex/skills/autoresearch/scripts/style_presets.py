#!/usr/bin/env python3
"""Optional matplotlib style presets for installed LitCodex autoresearch runs.

Call rcparams() before plt.subplots() or plt.figure(). Matplotlib snapshots rcParams
when a figure is constructed, so a later call is silently ignored and every preset
below — dpi, legend framing, the Okabe-Ito cycle, tick direction — is lost.
"""

import importlib
import json
import sys
from typing import Dict


OKABE_ITO = [
    "#E69F00",
    "#56B4E9",
    "#009E73",
    "#F0E442",
    "#0072B2",
    "#D55E00",
    "#CC79A7",
    "#000000",
]


def matplotlib_available() -> bool:
    """Return whether the optional plotting dependency imports successfully."""
    try:
        importlib.import_module("matplotlib")
    except Exception:
        return False
    return True


def preflight_report() -> Dict[str, object]:
    """Return a stable, non-installing optional dependency verdict."""
    available = matplotlib_available()
    return {
        "available": available,
        "code": (
            "OPTIONAL_MATPLOTLIB_READY"
            if available
            else "BLOCKED_OPTIONAL_MATPLOTLIB_UNAVAILABLE"
        ),
    }


def rcparams() -> None:
    """Apply the retained style after an explicit dependency preflight."""
    if not matplotlib_available():
        raise RuntimeError("BLOCKED_OPTIONAL_MATPLOTLIB_UNAVAILABLE")

    import matplotlib as mpl
    from matplotlib import font_manager, rcParams

    rcParams["font.family"] = "sans-serif"
    available_fonts = {font.name for font in font_manager.fontManager.ttflist}
    if "Pretendard" in available_fonts:
        rcParams["font.sans-serif"] = ["Pretendard"]
    elif "Arial" in available_fonts:
        rcParams["font.sans-serif"] = ["Arial"]

    rcParams.update(
        {
            "font.size": 14,
            "axes.titlesize": 18,
            "axes.titleweight": "normal",
            "axes.titlepad": 10,
            "axes.labelsize": 16,
            "axes.labelweight": "normal",
            "axes.labelpad": 8,
            "axes.linewidth": 1,
            "axes.edgecolor": "black",
            "axes.labelcolor": "black",
            "axes.axisbelow": True,
            "axes.grid": False,
            "axes.prop_cycle": mpl.cycler(color=OKABE_ITO),
            "xtick.labelsize": 12,
            "ytick.labelsize": 12,
            "xtick.direction": "in",
            "ytick.direction": "in",
            "xtick.minor.visible": True,
            "ytick.minor.visible": True,
            "xtick.major.width": 1,
            "ytick.major.width": 1,
            "xtick.minor.width": 0.5,
            "ytick.minor.width": 0.5,
            "xtick.major.size": 5,
            "ytick.major.size": 5,
            "xtick.minor.size": 3,
            "ytick.minor.size": 3,
            "xtick.major.pad": 7,
            "ytick.major.pad": 7,
            "xtick.color": "black",
            "ytick.color": "black",
            "figure.figsize": (5, 4),
            "figure.dpi": 100,
            "figure.facecolor": "white",
            "figure.autolayout": False,
            "lines.linewidth": 1.5,
            "lines.markersize": 5,
            "lines.markeredgewidth": 0.5,
            "legend.fontsize": 12,
            "legend.frameon": True,
            "legend.edgecolor": "black",
            "legend.framealpha": 1,
            "legend.loc": "best",
            "savefig.dpi": 600,
            "savefig.bbox": "tight",
            "savefig.pad_inches": 0.05,
            "savefig.transparent": False,
            "savefig.facecolor": "white",
            "image.cmap": "viridis",
        }
    )


if __name__ == "__main__":
    if sys.argv[1:] != ["--check"]:
        print("Usage: python style_presets.py --check", file=sys.stderr)
        raise SystemExit(2)
    print(json.dumps(preflight_report(), sort_keys=True))
