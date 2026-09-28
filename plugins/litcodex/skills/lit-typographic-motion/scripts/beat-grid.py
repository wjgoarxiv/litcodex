"""Tier 2 beat grid for lit-typographic-motion (MO-A-17..19).

Runs inside the librosa venv that `litcodex motion-runtime install --audio` created. Reads this
run's own audio file once, before any frame, and writes a small JSON grid (beat seconds, onsets,
coarse RMS envelope). The grid is a run artifact: never cached or reused for another brief.

Usage: python beat-grid.py <audio file> <out.json>
"""

import json
import sys
from pathlib import Path


def analyse(audio_path, out_path):
    import librosa
    import numpy as np

    y, sr = librosa.load(audio_path, sr=22050, mono=True)
    duration = float(len(y) / sr)
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr, units="time")
    onsets = librosa.onset.onset_detect(y=y, sr=sr, units="time")
    hop = 512
    rms = librosa.feature.rms(y=y, hop_length=hop)[0]
    peak = float(np.max(rms)) or 1.0
    grid = {
        "schema": 1,
        "tier": "librosa-beat-grid",
        "durationSec": round(duration, 4),
        "tempo": round(float(np.atleast_1d(tempo)[0]), 3),
        "beats": [round(float(t), 4) for t in beats],
        "onsets": [round(float(t), 4) for t in onsets],
        "rmsHopSec": hop / sr,
        "rms": [round(float(v) / peak, 4) for v in rms],
    }
    Path(out_path).write_text(json.dumps(grid) + "\n", encoding="utf8")
    return grid


def main(argv):
    if len(argv) != 3 or argv[1] in ("-h", "--help"):
        sys.stdout.write("lit-typographic-motion beat grid\nUsage: python beat-grid.py <audio file> <out.json>\n")
        return 0 if len(argv) == 2 else 2
    grid = analyse(argv[1], argv[2])
    sys.stdout.write(f"beats {len(grid['beats'])} tempo {grid['tempo']}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
