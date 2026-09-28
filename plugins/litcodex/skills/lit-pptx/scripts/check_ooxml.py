#!/usr/bin/env python3
"""Check a PPTX package after font embedding without external schemas."""

from __future__ import annotations

import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree

from pptx import Presentation


def check(path: Path) -> None:
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError("duplicate ZIP members")
        bad = archive.testzip()
        if bad:
            raise ValueError(f"corrupt ZIP member: {bad}")
        required = {"[Content_Types].xml", "ppt/presentation.xml", "ppt/_rels/presentation.xml.rels"}
        missing = required - set(names)
        if missing:
            raise ValueError(f"missing OOXML parts: {sorted(missing)}")
        types = ElementTree.fromstring(archive.read("[Content_Types].xml"))
        if not any(node.attrib.get("Extension") == "xml" for node in types):
            raise ValueError("missing XML content type")
        for name in names:
            if name.endswith((".xml", ".rels")):
                ElementTree.fromstring(archive.read(name))
        if any(name.endswith(".fntdata") for name in names):
            if not any(node.attrib.get("Extension") == "fntdata" for node in types):
                raise ValueError("embedded fonts lack content type")
    Presentation(path)


if __name__ == "__main__":
    check(Path(sys.argv[1]))
    print("OOXML integrity OK")
