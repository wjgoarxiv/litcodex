"""Deterministic office craft findings for python-pptx decks.

OF-101..OF-109 judge each slide. OF-110..OF-115 judge the output of a tonality pack as a whole:
how many title treatments the deck shows, whether its layouts vary, whether bodies are used,
whether each treatment keeps one frame, whether titles are labels rather than sentences, and
whether a region stands empty beside a full one (the floor under a bottom title, a side rail,
a takeaway column, a title panel, the page above a plate). OF-116 compares the deck with
another tonality of the same source (qa_deck.py --sibling), OF-117 fails a light figure
card on a dark ground, OF-118 a bold run-in label with no separator after it, and OF-119 a count
numeral beside an agenda's title. A pack deck carries its own marks (the subject stamp, `family@` and
`title@` shape names); a deck without them is judged by OF-101..OF-109 and OF-117 alone. The
limits live here so spec revisions change data rather than scattered checks.
"""
from __future__ import annotations

import colorsys
import io
import re
from pathlib import Path

from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE, MSO_SHAPE_TYPE
from pptx.enum.text import PP_ALIGN
from pptx.util import Inches

OF_LIMITS = {
    "full_bleed": .92, "hue_family_degrees": 20,
    "accent_saturation": .12, "accent_light_low": .12, "accent_light_high": .93,
    "body_min_pt": 10.5, "body_max_pt": 30, "latin_measure": 90,
    "cjk_measure": 38, "narrow_measure": 10, "narrow_lines": 3,
    "numeric_share": .70, "numeric_rows": 2,
    "frame_inset_tolerance_in": .06, "frame_radius_tolerance_in": .02,
    "frame_outer_radius_min_in": .04, "group_ratio": 2,
    "empty_medium": .25, "empty_high": .35, "row_tolerance_in": .05,
}
# OF-110..OF-113 read geometry in points, the unit of the design spec's treatment frames.
OUTPUT_LIMITS = {
    "tol": 2.0, "size_tol": .5, "min_slides": 8, "min_treatments": 3,
    "variety_cap": 5, "max_share": .40, "band_floor": 486.0, "footer_top": 492.0, "band_deck_max": .20,
    "band_caps": ((2, .28), (4, .24), (6, .20), (8, .16), (10, .12)), "anchor_tol": 1.0,
}
# OF-115: a region is empty past 40 % of its own height; a bottom title may end at most 12 pt above the floor.
REGION_LIMITS = {"floor_gap": 12.0, "share": .40}
# OF-117: on a ground darker than this luminance, a picture more than half near-white is a light card.
FIGURE_LIMITS = {"ground_max": .25, "near_white": 235, "share": .5, "min_area": .03}
TREATMENTS = ("top-rule", "top-plain-large", "side-rail", "band", "statement", "overlay", "kicker-numeral", "bottom-anchor")
TITLE_ZONE = {"top-rule": "top", "top-plain-large": "top", "kicker-numeral": "top", "side-rail": "side",
              "band": "band", "overlay": "overlay", "bottom-anchor": "bottom", "statement": "none"}
# Widest four-column title and the earliest column-5 start, per canvas width in points.
RAIL = {960: (288.0, 336.0), 720: (216.0, 252.0)}
GRID_MARGIN = {960: {"airy": 60.0, "standard": 48.0, "dense": 36.0, "compact": 24.0},
               720: {"airy": 54.0, "standard": 42.0, "dense": 30.0, "compact": 24.0}}
PACK_STAMP = re.compile(r"\blit-pptx tonality=(\S+) density=(\d+) grid=(\w+) variance=(\d+)")
NUMERAL = re.compile(r"\d+(?:[.:/-]\d+)?\.?")
# Families the engine draws as display pages: covers, sections, statements, quotes, full pictures.
DISPLAY_FAMILY = re.compile(r"^(?:cover|section)(?:-|$)|^(?:statement|quote|closing-statement|image-full)$")
QUOTE_GLYPHS = set("“”‘’\"«»「」『』")
EMU = Inches(1)
NS = {"a": "http://schemas.openxmlformats.org/drawingml/2006/main"}
EMOJI = re.compile(r"[\U0001F000-\U0001F0FF\U0001F300-\U0001FAFF\u2600-\u27BF]")


def _box(shape):
    return tuple(v / EMU for v in (shape.left, shape.top, shape.width, shape.height))


def _text(shape):
    return shape.text.strip() if getattr(shape, "has_text_frame", False) else ""


def _finding(items, rule, severity, slide, detail, **extra):
    items.append({"rule": rule, "severity": severity, "slide": slide, "detail": detail, **extra})


def family_of(shapes):
    """The `family@<id>` mark the engine puts on a slide's first shape, or ""."""
    return next((s.name.split("@", 1)[1] for s in shapes if s.name.startswith("family@")), "")


def title_frame(shapes):
    """The frame the engine named `title@<treatment>`, wherever the treatment puts it."""
    return next((s for s in shapes if s.name.startswith("title@") and _text(s)), None)


def bleeds(box, W, H, tol=.03):
    """A fill touching two or more canvas edges is a band, rail or field: page decoration."""
    x, y, w, h = box
    return sum((x <= tol, y <= tol, x + w >= W - tol, y + h >= H - tol)) >= 2


def _wrap_em(line):
    return sum(.90 if ord(ch) >= 0x1100 else .55 for ch in line)


def _numeric(value):
    raw = value.strip()
    if not raw:
        return False
    stripped = re.sub(r"[,\.\s%▲▼+\-±()$€£¥₩₹]", "", raw)
    return bool(stripped) and stripped.isdecimal()


def _radius(shape):
    try:
        return float(shape.adjustments[0]) * min(shape.width, shape.height) / EMU
    except (AttributeError, IndexError, ValueError, TypeError):
        return 0


def _gap_fraction(boxes, top, bottom):
    if bottom <= top:
        return 0
    cursor, gaps = top, []
    for _, y, _, h in sorted(boxes, key=lambda b: b[1]):
        if y + h <= top or y >= bottom:
            continue
        gaps.append(max(0, y - cursor))
        cursor = max(cursor, min(bottom, y + h))
    gaps.append(max(0, bottom - cursor))
    return max(gaps) / (bottom - top)


def analyze_craft(prs):
    """Return HIGH blockers and MEDIUM advisories; no render claims."""
    findings = []
    W, H = prs.slide_width / EMU, prs.slide_height / EMU
    stamp = PACK_STAMP.search(prs.core_properties.subject or "")
    margin = GRID_MARGIN[960 if round(W * 72) == 960 else 720].get(stamp.group(3), 48.0) / 72 if stamp else .5
    for sn, slide in enumerate(prs.slides, 1):
        # The notice line and a lone quotation-mark ornament are furniture, not content.
        shapes = [s for s in slide.shapes if not s.name.startswith("lit-notice") and _text(s) not in QUOTE_GLYPHS]
        family = family_of(shapes)
        title = title_frame(shapes) or next((s for s in shapes if _text(s) and _box(s)[1] < H * .22), None)
        display = len([s for s in shapes if _text(s)]) <= 2 and any(
            (r.font.size.pt if r.font.size else 0) >= OF_LIMITS["body_max_pt"]
            for s in shapes if getattr(s, "has_text_frame", False)
            for p in s.text_frame.paragraphs for r in p.runs
        )
        if family:
            display = bool(DISPLAY_FAMILY.search(family))

        accents = []
        for s in shapes:
            x, y, w, h = _box(s)
            if w * h >= OF_LIMITS["full_bleed"] * W * H:
                continue
            try:
                rgb = s.fill.fore_color.rgb
                if rgb is None:
                    continue
                hue, light, sat = colorsys.rgb_to_hls(*(v / 255 for v in rgb))
                if sat >= OF_LIMITS["accent_saturation"] and OF_LIMITS["accent_light_low"] <= light <= OF_LIMITS["accent_light_high"]:
                    angle = hue * 360
                    if not any(min(abs(angle - prior), 360 - abs(angle - prior)) <= OF_LIMITS["hue_family_degrees"] for prior in accents):
                        accents.append(angle)
            except (AttributeError, TypeError):
                continue
        findings += light_figures(sn, slide, W * 72, H * 72)
        findings += check_run_ins(sn, slide)
        count = len(accents)
        if count >= (4 if display else 3):
            _finding(findings, "OF-101", "HIGH", sn, f"{count} accent families")
        elif count >= (3 if display else 2):
            _finding(findings, "OF-101", "MEDIUM", sn, f"{count} accent families")

        for s in shapes:
            if getattr(s, "has_text_frame", False):
                for p in s.text_frame.paragraphs:
                    if p._p.xpath("./a:pPr/a:buChar"):
                        char = p._p.xpath("./a:pPr/a:buChar")[0].get("char", "")
                        if EMOJI.search(char):
                            _finding(findings, "OF-108", "HIGH", sn, "emoji bullet")
                    for r in p.runs:
                        if r._r.xpath("./a:rPr/a:gradFill"):
                            _finding(findings, "OF-106", "HIGH", sn, "gradient text")
                # A section's preview of what it opens is set wide on purpose (two lines an entry, at most 70 % of
                # the page and about 70 characters), so the body-text measure does not apply to it.
                if s is not title and _text(s) and not family.startswith("section"):
                    sizes = [r.font.size.pt for p in s.text_frame.paragraphs for r in p.runs if r.font.size]
                    if sizes and OF_LIMITS["body_min_pt"] < max(sizes) < OF_LIMITS["body_max_pt"]:
                        line_count = sum(max(1, len(p.text.splitlines())) for p in s.text_frame.paragraphs)
                        # Explicit lines are exact; wrapping is a conservative estimate per line: 0.55 em a
                        # character, 0.90 em a Hangul or other wide glyph (almost twice a Latin letter).
                        width = max(.1, _box(s)[2] - (s.text_frame.margin_left + s.text_frame.margin_right) / EMU)
                        per_line = width * 72 / max(sizes)
                        wrapped = sum(max(1, -(-_wrap_em(line) // per_line)) for p in s.text_frame.paragraphs
                                      for line in (p.text.splitlines() or [""]))
                        line_count = max(line_count, int(wrapped))
                        if line_count >= 2:
                            chars = len(_text(s).replace("\n", ""))
                            cjk = sum('\uac00' <= c <= '\ud7a3' for c in _text(s)) / max(1, chars) >= .5
                            measure = chars / line_count
                            cap = OF_LIMITS["cjk_measure" if cjk else "latin_measure"]
                            if measure > cap:
                                _finding(findings, "OF-102", "HIGH", sn, f"{measure:.1f} chars/line exceeds {cap}")
                            elif line_count >= OF_LIMITS["narrow_lines"] and measure < OF_LIMITS["narrow_measure"]:
                                _finding(findings, "OF-102", "MEDIUM", sn, f"{measure:.1f} chars/line")
            if s._element.xpath(".//a:effectLst/a:glow"):
                _finding(findings, "OF-107", "HIGH", sn, "glow effect")

            if getattr(s, "has_table", False):
                table = s.table
                # `first_row` is the table's own OOXML header flag. With no
                # header style, the first row remains the documented fallback.
                header_rows = 1 if table.first_row else 1
                rows = list(table.rows)[header_rows:]
                if len(rows) >= OF_LIMITS["numeric_rows"]:
                    for col in range(len(table.columns)):
                        values = [row.cells[col] for row in rows]
                        candidates = [c for c in values if c.text.strip()]
                        if not candidates or sum(_numeric(c.text) for c in candidates) / len(candidates) < OF_LIMITS["numeric_share"]:
                            continue
                        for c in values:
                            if not _numeric(c.text):
                                continue
                            for p in c.text_frame.paragraphs:
                                if p.alignment is None:
                                    _finding(findings, "OF-103", "MEDIUM", sn, "numeric alignment inherited", tier="derived")
                                elif p.alignment != PP_ALIGN.RIGHT:
                                    _finding(findings, "OF-103", "HIGH", sn, "numeric cell not right aligned")

        rounds = [s for s in shapes if s.shape_type == MSO_SHAPE_TYPE.AUTO_SHAPE and s.auto_shape_type == MSO_SHAPE.ROUNDED_RECTANGLE]
        for outer in rounds:
            ox, oy, ow, oh = _box(outer)
            for inner in rounds:
                if inner is outer:
                    continue
                ix, iy, iw, ih = _box(inner)
                pads = (ix-ox, iy-oy, ox+ow-ix-iw, oy+oh-iy-ih)
                if min(pads) < 0 or max(pads)-min(pads) > OF_LIMITS["frame_inset_tolerance_in"]:
                    continue
                radius = _radius(outer)
                expected = max(0, radius - sum(pads)/4)
                if radius > OF_LIMITS["frame_outer_radius_min_in"] and abs(_radius(inner)-expected) > OF_LIMITS["frame_radius_tolerance_in"]:
                    _finding(findings, "OF-104", "HIGH", sn, "nested frame radius differs from inset")

        # Explicit card boundaries make group membership measurable. Until the
        # template corpus is recalibrated, OF-105 remains advisory.
        cards = [s for s in shapes if s.shape_type == MSO_SHAPE_TYPE.AUTO_SHAPE and
                 _box(s)[2] > 1 and _box(s)[3] > .7 and s is not title and not bleeds(_box(s), W, H)]
        groups = []
        for card in cards:
            cx, cy, cw, ch = _box(card)
            members = [s for s in shapes if s is not card and _text(s) and
                       cx <= _box(s)[0] and cy <= _box(s)[1] and
                       _box(s)[0]+_box(s)[2] <= cx+cw and _box(s)[1]+_box(s)[3] <= cy+ch]
            if len(members) >= 2:
                member_boxes = [_box(s) for s in members]
                gaps = []
                for index, a in enumerate(member_boxes):
                    for b in member_boxes[index+1:]:
                        dx = max(0, b[0]-a[0]-a[2], a[0]-b[0]-b[2])
                        dy = max(0, b[1]-a[1]-a[3], a[1]-b[1]-b[3])
                        gaps.append((dx*dx+dy*dy)**.5)
                groups.append((card, min(gaps, default=0), members))
        for i, (a, gap_a, _) in enumerate(groups):
            ax, ay, aw, ah = _box(a)
            for b, gap_b, _ in groups[i+1:]:
                bx, by, bw, bh = _box(b)
                if abs(ay-by) > .1 or abs(ah-bh) > .1:
                    continue
                between = max(0, bx-ax-aw) if ax < bx else max(0, ax-bx-bw)
                if between < OF_LIMITS["group_ratio"] * max(gap_a, gap_b):
                    _finding(findings, "OF-105", "MEDIUM", sn, "between-card gap below 2x within-card gap")

        if not display:
            top = (_box(title)[1] + _box(title)[3] + .1) if title else .5
            left, bottom = 0, H - .55
            if title is not None and title.name == "title@side-rail":
                # Nothing sits under a side rail by design: the body is the column beside it, from the top.
                top, left = _box(title)[1], _box(title)[0] + _box(title)[2]
            elif title is not None and title.name == "title@bottom-anchor":
                # A bottom title closes the page: the body runs from the top margin down to it.
                top, bottom = margin, _box(title)[1]
            content = [_box(s) for s in shapes if s is not title and _box(s)[0] >= left - .05 and
                       (_text(s) or s in cards or getattr(s, "has_table", False) or getattr(s, "has_chart", False)
                        or s.shape_type == MSO_SHAPE_TYPE.PICTURE) and
                       _box(s)[1] >= top and _box(s)[1] < bottom]
            fraction = _gap_fraction(content, top, bottom)
            if fraction > OF_LIMITS["empty_high"]:
                _finding(findings, "OF-109", "HIGH", sn, f"largest empty band {fraction:.2f}")
            elif fraction >= OF_LIMITS["empty_medium"]:
                _finding(findings, "OF-109", "MEDIUM", sn, f"largest empty band {fraction:.2f}")

            # Equal-height card rows inherit their height from their fullest
            # sibling. Score the row's least-empty card, once per row.
            card_fractions = []
            for card in cards:
                cx, cy, cw, ch = _box(card)
                if cw * ch >= OF_LIMITS["full_bleed"] * W * H:
                    continue
                children = [s for s in shapes if s is not card and s is not title and
                            cx <= _box(s)[0] and cy <= _box(s)[1] and
                            _box(s)[0]+_box(s)[2] <= cx+cw and _box(s)[1]+_box(s)[3] <= cy+ch and _text(s)]
                if not children:
                    continue
                biggest = max((r.font.size.pt if r.font.size else 0 for s in children if getattr(s, "has_text_frame", False)
                               for p in s.text_frame.paragraphs for r in p.runs), default=0)
                if biggest >= OF_LIMITS["body_max_pt"] and len(children) <= 2:
                    continue
                margin_top = card.text_frame.margin_top / EMU if card.has_text_frame else 0
                margin_bottom = card.text_frame.margin_bottom / EMU if card.has_text_frame else 0
                inner_top, inner_bottom = cy + margin_top, cy + ch - margin_bottom
                card_fractions.append((card, _gap_fraction([_box(child) for child in children], inner_top, inner_bottom)))
            seen_cards = set()
            for card, value in card_fractions:
                if id(card) in seen_cards:
                    continue
                cx, cy, cw, ch = _box(card)
                row = [(other, amount) for other, amount in card_fractions if
                       abs(_box(other)[1]-cy) <= OF_LIMITS["row_tolerance_in"] and
                       abs(_box(other)[3]-ch) <= OF_LIMITS["row_tolerance_in"]]
                seen_cards.update(id(other) for other, _ in row)
                fraction = min(amount for _, amount in row)
                if fraction > OF_LIMITS["empty_high"]:
                    _finding(findings, "OF-109", "HIGH", sn, f"card-row empty band {fraction:.2f}")
                elif fraction >= OF_LIMITS["empty_medium"]:
                    _finding(findings, "OF-109", "MEDIUM", sn, f"card-row empty band {fraction:.2f}")

    findings += analyze_output(prs) + check_labels(prs)
    return {"pass": not any(f["severity"] == "HIGH" for f in findings), "findings": findings}


# ── OF-110..OF-113: the deck as a tonality pack drew it ─────────────────────

def _pt(shape):
    try:
        return tuple(v / 12700 for v in (shape.left, shape.top, shape.width, shape.height))
    except (TypeError, ValueError):
        return None


def _drawn(slide, W, H):
    """Each drawn shape in points with its kind and its role (content, card or decoration)."""
    items = []
    for s in slide.shapes:
        box = _pt(s)
        if box is None or box[2] + box[3] <= 0 or s.name.startswith("lit-notice"):
            continue
        text = _text(s)
        if s.shape_type == MSO_SHAPE_TYPE.PICTURE:
            kind = "picture"
        elif getattr(s, "has_table", False) and s.has_table:
            kind = "table"
            box = (*box[:3], max(box[3], sum(row.height for row in s.table.rows) / 12700))
        elif getattr(s, "has_chart", False) and s.has_chart:
            kind = "chart"
        else:
            kind = "text" if text else "shape"
        try:
            filled = kind == "shape" and s.fill.type == 1
        except (AttributeError, TypeError):
            filled = False
        sizes = [r.font.size.pt for p in s.text_frame.paragraphs for r in p.runs
                 if r.text.strip() and r.font.size] if getattr(s, "has_text_frame", False) else []
        items.append({"name": s.name, "kind": kind, "x": box[0], "y": box[1], "w": box[2], "h": box[3],
                      "text": text, "sizes": sizes, "filled": filled})
    for item in items:
        if item["kind"] != "shape":
            item["role"] = "content"
            continue
        holds = any(o["kind"] != "shape" and _inside(o, item) for o in items if o is not item)
        edge = bleeds(tuple(v / 72 for v in (item["x"], item["y"], item["w"], item["h"])), W / 72, H / 72)
        card = (item["filled"] and holds and not edge and item["w"] >= 100 and item["h"] >= 40
                and item["w"] * item["h"] < .5 * W * H)
        item["role"] = "card" if card else "decoration"
    return items


def _inside(item, box, tol=1.0):
    cx, cy = item["x"] + item["w"] / 2, item["y"] + item["h"] / 2
    return box["x"] - tol <= cx <= box["x"] + box["w"] + tol and box["y"] - tol <= cy <= box["y"] + box["h"] + tol


def _in_footer(item):
    return item["y"] >= OUTPUT_LIMITS["footer_top"]


def treatment_of(title, items, W, H):
    """The treatment a title frame shows, tested in the spec's order; the first match wins."""
    tol, slack = OUTPUT_LIMITS["tol"], OUTPUT_LIMITS["size_tol"]
    size = max(title["sizes"] or [0])
    bottom = title["y"] + title["h"]
    others = [o for o in items if o is not title]
    body = [o for o in others if not _in_footer(o) and o["role"] != "decoration"]

    def behind(o):
        return (o["x"] - tol <= title["x"] and title["x"] + title["w"] <= o["x"] + o["w"] + tol
                and o["y"] - tol <= title["y"] and bottom <= o["y"] + o["h"] + tol)

    if (any(o["kind"] == "picture" and o["w"] * o["h"] >= .8 * W * H for o in others) and title["y"] >= 300 - tol
            and any(o["kind"] == "shape" and o["filled"] and behind(o) for o in others)):
        return "overlay"
    if any(o["kind"] == "shape" and o["filled"] and o["y"] <= 2 + tol and 96 - tol <= o["h"] <= 120 + tol
           and o["w"] >= .9 * W and _inside(title, o, tol) for o in others):
        return "band"
    if (size >= 36 - slack and 220 - tol <= title["y"] + title["h"] / 2 <= 380 + tol
            and not any(o["kind"] in ("table", "chart", "picture") or o["role"] == "card" for o in body)
            and sum(o["kind"] == "text" for o in body) <= 1):
        return "statement"
    if title["y"] >= 360 - tol and all(o["y"] <= title["y"] + tol for o in body if o["kind"] == "text"):
        return "bottom-anchor"
    rail_w, column_5 = RAIL.get(round(W), RAIL[960])
    beside = [o for o in body if o["x"] + o["w"] / 2 > title["x"] + title["w"]]
    # Criteria labels, takeaways and the source may stand in the rail under the title; only a block that
    # runs from the rail into the body makes the title something else.
    if (title["w"] <= rail_w + tol and beside and min(o["x"] for o in beside) >= column_5 - tol
            and not any(o["x"] < column_5 - tol and o["y"] > bottom and o["x"] + o["w"] > column_5 + tol for o in body)):
        return "side-rail"
    for o in others:
        if (o["kind"] == "text" and o["sizes"] and NUMERAL.fullmatch(o["text"]) and max(o["sizes"]) >= 44 - slack
                and o["x"] + o["w"] <= title["x"] + tol and o["y"] >= 30 - tol and o["y"] + o["h"] <= 114 + tol):
            return "kicker-numeral"
    if title["y"] <= 48 + tol:
        # A rule is a line under the title, never a list-marker dot.
        rule = any(o["kind"] == "shape" and o["h"] <= 8 and o["w"] >= max(16, 4 * o["h"])
                   and bottom - tol <= o["y"] <= bottom + 24 and o["x"] < title["x"] + title["w"]
                   and o["x"] + o["w"] > title["x"] for o in others)
        if size >= 36 - slack and not rule:
            return "top-plain-large"
        if size <= 32 + slack and rule:
            return "top-rule"
    return "unclassified"


def _is_figure(item):
    """Display-size text that is mostly digits reads as a number, not text."""
    compact = re.sub(r"\s+", "", item["text"])
    digits = len(re.findall(r"\d", compact))
    return (item["kind"] == "text" and bool(item["sizes"]) and max(item["sizes"]) >= 44 - OUTPUT_LIMITS["size_tol"]
            and digits / max(1, len(compact)) >= .5)


def signature_of(title, treatment, items, W, margin):
    """(title zone, body partition, dominant content) of one content slide.

    Body boxes share a column when they overlap by half the narrower one; a box wider than 70 %
    of the body (a takeaway under two columns) never joins columns.
    """
    zone = TITLE_ZONE.get(treatment, "none")
    if treatment == "statement":
        return (zone, "one", "text")
    column_5 = RAIL.get(round(W), RAIL[960])[1]
    body = [o for o in items if o is not title and not _in_footer(o) and o["role"] != "decoration"
            # what stands in a side title's rail belongs to the title zone, not to the body's columns
            and not (treatment == "side-rail" and o["x"] + o["w"] <= column_5 + OUTPUT_LIMITS["tol"])
            and not (o["kind"] == "shape" and title is not None and _inside(title, o, 0))
            and not (treatment == "kicker-numeral" and o["kind"] == "text" and NUMERAL.fullmatch(o["text"])
                     and o["y"] + o["h"] <= 116)]
    cards = [o for o in body if o["role"] == "card"]
    blocks = [o for o in body if not any(c is not o and _inside(o, c) for c in cards)]
    if any(o["kind"] == "picture" and o["w"] * o["h"] >= .8 * W * 540 for o in items):
        partition = "full-bleed"
    elif not blocks:
        partition = "one"
    else:
        narrow = [o for o in blocks if o["w"] < .7 * (W - 2 * margin)] or blocks
        columns = []
        for o in sorted(narrow, key=lambda o: o["x"]):
            hits = [c for c in columns if min(c["r"], o["x"] + o["w"]) - max(c["l"], o["x"]) >= .5 * min(c["r"] - c["l"], o["w"])]
            if hits:
                keep = hits[0]
                for extra in hits[1:]:
                    keep["l"], keep["r"] = min(keep["l"], extra["l"]), max(keep["r"], extra["r"])
                    keep["items"] += extra["items"]
                    columns.remove(extra)
                keep["l"], keep["r"] = min(keep["l"], o["x"]), max(keep["r"], o["x"] + o["w"])
                keep["items"].append(o)
            else:
                columns.append({"l": o["x"], "r": o["x"] + o["w"], "items": [o]})
        column = {id(i): n for n, c in enumerate(columns) for i in c["items"]}
        rows = []
        for o in sorted(narrow, key=lambda o: o["y"]):
            if rows and o["y"] < rows[-1]["bottom"] - 2:
                rows[-1]["bottom"] = max(rows[-1]["bottom"], o["y"] + o["h"])
                rows[-1]["items"].append(o)
            else:
                rows.append({"bottom": o["y"] + o["h"], "items": [o]})
        multi = sum(1 for r in rows if len({column[id(i)] for i in r["items"]}) >= 2)
        k = len(columns)
        if k >= 4 or (k >= 2 and multi >= 2):
            partition = "grid"
        elif k == 3:
            partition = "three"
        elif k == 2:
            a, b = (c["r"] - c["l"] for c in columns)
            partition = "two-even" if min(a, b) / max(a, b) >= .85 else "two-asym"
        else:
            partition = "one"
    area = {}
    for o in blocks:
        key = {"picture": "image", "table": "table", "chart": "chart"}.get(o["kind"])
        if o["kind"] == "text":
            key = "number" if _is_figure(o) else "text"
        if key:
            area[key] = area.get(key, 0) + o["w"] * o["h"]
    for c in cards:
        key = "number" if any(_is_figure(o) for o in body if o is not c and _inside(o, c)) else "text"
        area[key] = area.get(key, 0) + c["w"] * c["h"]
    return (zone, partition, max(area, key=area.get) if area else "text")


def empty_under(title, items, top_margin=36.0):
    """Share of the body left empty under its lowest block, from the title (or the top margin when
    the title sits low) to the body floor; decoration, footer and notice excluded."""
    floor = OUTPUT_LIMITS["band_floor"]
    top = title["y"] + title["h"] if title is not None and title["y"] + title["h"] < floor * .6 else top_margin
    if floor - top < 10:
        return None
    ink = [o for o in items if o["role"] != "decoration" and not _in_footer(o) and o["y"] < floor and o["y"] + o["h"] > top]
    lowest = max((min(floor, o["y"] + o["h"]) for o in ink), default=top)
    return max(0.0, (floor - lowest) / (floor - top))


def _role(family):
    return next((k for k in ("cover", "section", "closing") if family == k or family.startswith(k + "-")), "content")


def read_slides(prs):
    """Each slide's drawn items, family, role, written and drawn treatment, and a content slide's signature."""
    W, H = prs.slide_width / 12700, prs.slide_height / 12700
    stamp = PACK_STAMP.search(prs.core_properties.subject or "")
    margin = GRID_MARGIN[960 if round(W) == 960 else 720].get(stamp.group(3) if stamp else "standard", 48.0)
    slides = []
    for n, slide in enumerate(prs.slides, 1):
        items = _drawn(slide, W, H)
        family = family_of(list(slide.shapes))
        title = next((o for o in items if o["name"].startswith("title@")), None)
        s = {"n": n, "items": items, "family": family, "role": _role(family), "title": title,
             "named": title["name"].split("@", 1)[1] if title else None}
        s["drawn"] = treatment_of(title, items, W, H) if title and title["sizes"] else None
        if s["role"] == "content":
            s["signature"] = signature_of(title, s["drawn"], items, W, margin)
        slides.append(s)
    return W, H, stamp, slides


def analyze_output(prs):
    """OF-110..OF-113 and OF-115 over a deck the engine stamped; [] for any other deck."""
    found = []
    W, H, stamp, slides = read_slides(prs)
    density, variance = (int(stamp.group(2)), int(stamp.group(4))) if stamp else (5, 5)
    if not any(s["named"] for s in slides):
        return found
    # A legacy template has no fill policies or treatments of its own: its variety is advisory.
    weight = "MEDIUM" if any(s["named"] == "legacy" for s in slides) else "HIGH"
    for s in slides:
        if s["named"] in TREATMENTS and s["drawn"] not in (None, s["named"]):
            _finding(found, "OF-110", "HIGH", s["n"], f"title drawn as {s['drawn']}, named {s['named']}",
                     hint="Draw the treatment with its own frame and companions; the name must match the page.")
    titled = [s for s in slides if s["role"] not in ("cover", "section") and s["drawn"]]
    used = sorted({s["drawn"] for s in titled} - {"unclassified"})
    loose = [s["n"] for s in titled if s["drawn"] == "unclassified"]
    allowed = 2 if variance <= 3 else 3 if variance == 4 else 4 if variance <= 6 else 5
    if len(slides) >= OUTPUT_LIMITS["min_slides"]:
        if variance <= 3 and len(used) < OUTPUT_LIMITS["min_treatments"]:
            _finding(found, "OF-110", "MEDIUM", None, f"{len(used)} title treatment(s) at variance {variance}, lowered on request",
                     hint="Variance under 4 is the user's call; say so in the reply.")
        elif len(used) < OUTPUT_LIMITS["min_treatments"]:
            _finding(found, "OF-110", weight, None, f"{len(used)} title treatment(s) ({', '.join(used) or 'none'}) on {len(slides)} slides",
                     hint="Give slide roles the pack's treatments: data beside a rail or over a bottom title, steps under a numeral.")
        elif stamp and len(used) > allowed:
            _finding(found, "OF-110", weight, None, f"{len(used)} title treatments where variance {variance} allows {allowed}",
                     hint="Drop a treatment or raise variance by at most 2.")
    if loose:
        _finding(found, "OF-110", weight, loose[0], f"no treatment recognised on slide(s) {', '.join(map(str, loose))}",
                 hint="Put the title on one of the eight treatment frames.")
    content = [s for s in slides if s["role"] == "content"]
    if len(content) >= 3:
        need = min(OUTPUT_LIMITS["variety_cap"], -(-len(content) * 3 // 5))
        problems = []
        for label, key in (("signature", lambda s: s["signature"]), ("layout", lambda s: s["signature"][:2])):
            counts = {}
            for s in content:
                counts[key(s)] = counts.get(key(s), 0) + 1
            top, top_n = max(counts.items(), key=lambda kv: kv[1])
            if len(counts) < need:
                problems.append(f"{label}: {len(counts)} distinct of {need} needed")
            if top_n / len(content) > OUTPUT_LIMITS["max_share"]:
                problems.append(f"{label}: {'/'.join(top)} on {top_n} of {len(content)} content slides")
        if problems:
            _finding(found, "OF-111", weight, None, "; ".join(problems),
                     hint="Change the family or treatment on the repeated slides; let each slide's job choose its shape.")
    cap = next(c for upto, c in OUTPUT_LIMITS["band_caps"] if density <= upto)
    bands = []
    for s in slides:
        if s["role"] in ("cover", "section") or s["family"] in ("statement", "quote", "closing-statement") or s["drawn"] == "statement":
            continue
        band = empty_under(s["title"], s["items"])
        if band is None:
            continue
        bands.append(band)
        if band > cap:
            _finding(found, "OF-112", "MEDIUM", s["n"], f"{band:.0%} of the body empty under the last block (cap {cap:.0%} at density {density})",
                     hint="Use the pack's fill order: larger type, a grown visual, wider gaps, or a family that fits.")
    if bands:
        bands.sort()
        mid = len(bands) // 2
        median = bands[mid] if len(bands) % 2 else (bands[mid - 1] + bands[mid]) / 2
        if median > OUTPUT_LIMITS["band_deck_max"]:
            _finding(found, "OF-112", weight, None, f"median empty band {median:.2f} over {len(bands)} slides",
                     hint="Give content slides content that reaches the floor: a takeaway under a table, a next step under an ask.")
    groups = {}
    for s in titled:
        if s["drawn"] in TREATMENTS and s["named"] in TREATMENTS:
            groups.setdefault(s["drawn"], []).append(s)
    # A statement is centred, so only its x and width repeat. A bottom title stands on the floor: its bottom
    # edge repeats and its top follows its line count.
    edge = lambda t, k: t["y"] + t["h"] if k == "bottom" else t[k]  # noqa: E731
    for treatment, group in groups.items():
        keys = ("x", "w") if treatment == "statement" else ("x", "w", "bottom") if treatment == "bottom-anchor" else ("x", "y", "w")
        modes = {}
        for k in keys:
            values = [round(edge(s["title"], k)) for s in group]
            modes[k] = max(set(values), key=values.count)
        for s in group:
            off = [f"{k} {edge(s['title'], k):.0f} vs {modes[k]}" for k in keys if abs(edge(s["title"], k) - modes[k]) > OUTPUT_LIMITS["anchor_tol"]]
            if off:
                _finding(found, "OF-113", "HIGH", s["n"], f"{treatment} title off its frame: {', '.join(off)}",
                         hint="Keep one frame per treatment; fix the source rather than nudging a title.")
    return found + empty_regions(slides, W, H) + agenda_numerals(slides)


# ── OF-115: no region stands empty beside a full one ────────────────────────
# OF-112 reads the body as one page; a region can still be empty beside a full one. Each region is
# measured against its own height (40 %), and the floor under a bottom title as a distance (12 pt).

def _title_lines(title):
    """Lines the title's text takes: explicit breaks, each wrapped at its frame width (Hangul 0.90 em)."""
    size = max(title["sizes"] or [1.0])
    inner = max(1.0, title["w"] - 14.4)
    return sum(max(1, -(-_wrap_em(line) * size // inner)) for line in (title["text"].splitlines() or [""]))


def _open_stretch(top, bottom, spans):
    """The tallest stretch of [top, bottom] that no (y0, y1) span covers."""
    gap, cursor = 0.0, top
    for y0, y1 in sorted(spans):
        if y1 <= cursor:
            continue
        gap = max(gap, min(y0, bottom) - cursor)
        cursor = max(cursor, y1)
    return max(gap, bottom - cursor)


def _short_column(n, content, title, treatment, body_floor, column_5, fields, family=None):
    """OF-115 for a column of a two-column body that stops short of its neighbour: the largest empty band inside
    it, from the body's top down to where the neighbour ends, is over 40 % of the body. A source or note strip
    that closes the column does not hide the band above it. Beside the figures of a kpi-row or big-number slide
    the column is measured to the body floor (spec-v2 Amendments 9)."""
    tol = OUTPUT_LIMITS["tol"]
    # The body starts under a top title; beside a side title (in its rail) or over a bottom title, at the top.
    top_of_title = title["y"] + title["h"] if treatment not in ("bottom-anchor", "side-rail") else 0.0
    body = [o for o in content if top_of_title - tol <= o["y"] < body_floor and o["w"] > 0 and o["h"] > 0
            and not (treatment == "side-rail" and o["x"] + o["w"] <= column_5 + tol) and not any(_inside(o, f) for f in fields)]
    if len(body) < 2:
        return None
    left_edge, right_edge = min(o["x"] for o in body), max(o["x"] + o["w"] for o in body)
    for cut in sorted({o["x"] + o["w"] for o in body}):
        a = [o for o in body if o["x"] + o["w"] <= cut + tol]
        b = [o for o in body if o["x"] >= cut - tol]
        # A block across most of the body (a note under both columns) belongs to neither column; a narrower
        # block across the cut means there is no column line here.
        across = [o for o in body if o not in a and o not in b]
        if not a or not b or any(o["w"] < .7 * (right_edge - left_edge) for o in across):
            continue
        top = min(o["y"] for o in a + b)
        for column, other in ((a, b), (b, a)):
            # Takeaways beside a chart that close with the chart's values: the table counts as a block of the
            # column at its drawn extent (the reader already takes the taller of frame and rows).
            values = (any(o["kind"] == "chart" for o in other) and any(o["kind"] == "text" for o in column)
                      and not any(o["kind"] in ("chart", "picture") for o in column))
            # A text column, or a picture drawn smaller than its column, beside a column that runs on.
            if not any(o["kind"] in ("text", "picture") for o in column) or (
                    any(o["kind"] in ("chart", "table") for o in column) and not values):
                continue
            # Row heads (a matrix's or a comparison's short labels, each level with its row) are no column to fill.
            if all(o["kind"] == "text" and o["h"] <= 56 and len(re.sub(r"\s+", "", o["text"])) <= 16 for o in column):
                continue
            # Read whatever the neighbour's length: one that stops short still marks how far this column should run.
            reach = min(body_floor, max(o["y"] + o["h"] for o in other))
            # A takeaway column beside the figures of a kpi-row or big-number slide runs to the body floor: the rows stop
            # where their spacing ends. The figures' own labels stand exactly level with figures below the first row.
            size = lambda side: max([max(o["sizes"]) for o in side if o["kind"] == "text" and o["sizes"]] or [0.0])  # noqa: E731
            figures = [o for o in other if o["kind"] == "text" and o["sizes"] and max(o["sizes"]) > size(column) + 4]
            labels = any(abs(o["y"] - f["y"]) <= .5 and f["y"] > top + tol for o in column for f in figures)
            if family in ("kpi-row", "big-number") and figures and not labels:
                reach = body_floor
            share = _open_stretch(top, reach, [(o["y"], o["y"] + o["h"]) for o in column]) / max(1.0, body_floor - top)
            if share > REGION_LIMITS["share"]:
                kind = "picture" if any(o["kind"] == "picture" for o in column) else "text"
                items = []
                _finding(items, "OF-115", "HIGH", n, f"the {kind} column beside a longer one leaves {share:.0%} of the body empty inside it",
                         hint="Fill the column by layout: lead size, the source and values in the column, a narrower column with a wider visual, or the points under the visual.")
                return items[0]
    return None


def empty_regions(slides, W, H):
    found = []
    floor, tol, share_max = OUTPUT_LIMITS["band_floor"], OUTPUT_LIMITS["tol"], REGION_LIMITS["share"]
    column_5 = RAIL.get(round(W), RAIL[960])[1]
    for s in slides:
        title, treatment = s["title"], s["drawn"]
        if title is None:
            continue
        full_bleed = lambda o: o["kind"] == "picture" and o["w"] * o["h"] >= .8 * W * H  # noqa: E731
        content = [o for o in s["items"] if o is not title and o["role"] != "decoration" and not _in_footer(o) and not full_bleed(o)]
        if s["role"] in ("content", "closing") and title["sizes"]:
            if treatment == "bottom-anchor":
                gap = floor - (title["y"] + _title_lines(title) * max(title["sizes"]) * 1.15)
                if gap > REGION_LIMITS["floor_gap"]:
                    _finding(found, "OF-115", "HIGH", s["n"], f"the bottom title ends {gap:.0f} pt above the body floor",
                             hint="Stand the title's last line on the floor and give the visual above it the room.")
            if treatment == "side-rail" and s["family"] not in ("quote", "statement"):
                top = title["y"] + title["h"]  # the frame keeps a spare line for a title that wraps once more
                rail = [(o["y"], o["y"] + o["h"]) for o in content if o["x"] + o["w"] <= column_5 + tol and o["y"] + o["h"] > top]
                share = _open_stretch(top, floor, rail) / max(1.0, floor - top)
                if share > share_max:
                    _finding(found, "OF-115", "HIGH", s["n"], f"{share:.0%} of the side rail under the title is empty",
                             hint="Stand the slide's criteria labels, takeaways or source in the rail, or take a top or bottom title.")
            # A takeaway column beside a chart, table or picture that runs on below the column's last block.
            body_floor = title["y"] - tol if treatment == "bottom-anchor" else floor
            fields = [o for o in s["items"] if o["kind"] == "shape" and o["filled"] and o["w"] * o["h"] >= .1 * W * H]
            short = _short_column(s["n"], content, title, treatment, body_floor, column_5, fields, s["family"])
            if short:
                found.append(short)
            for v in ([] if short else (o for o in content if o["kind"] in ("chart", "table", "picture"))):
                # Text on a colour field (a closing's ask) stands on its own ground, not in a column.
                beside = [o for o in content if o["kind"] == "text" and o["y"] < v["y"] + v["h"] and o["y"] + o["h"] > v["y"]
                          and (o["x"] >= v["x"] + v["w"] - tol or o["x"] + o["w"] <= v["x"] + tol)
                          and not any(_inside(o, f) for f in fields)]
                if not beside:
                    continue
                left, right = min(o["x"] for o in beside), max(o["x"] + o["w"] for o in beside)
                top = min([v["y"]] + [o["y"] for o in beside])
                column = max(o["y"] + o["h"] for o in content if left - tol <= o["x"] + o["w"] / 2 <= right + tol)
                visual = min(body_floor, max(o["y"] + o["h"] for o in content if v["x"] - tol <= o["x"] + o["w"] / 2 <= v["x"] + v["w"] + tol))
                share = (visual - column) / max(1.0, body_floor - top)
                if share > share_max:
                    _finding(found, "OF-115", "HIGH", s["n"], f"the column beside the {v['kind']} leaves {share:.0%} of the body empty under its last block",
                             hint="Close the column with the source and note lines, the chart's values or the takeaways; never stretch the visual alone.")
                    break
        if s["role"] in ("cover", "section") or treatment in ("statement", "overlay"):
            # A title panel over a picture, and a plate under a statement or quote; a type-led cover's plate
            # is a device of the cover, not a region its text must fill.
            pictured = any(full_bleed(o) for o in s["items"])
            for p in (o for o in s["items"] if o["kind"] == "shape" and o["filled"] and _inside(title, o) and o["w"] * o["h"] < .9 * W * H):
                inside = [o for o in content + [title] if o is not p and _inside(o, p)]
                if p["y"] > tol and pictured:
                    bottom = min(p["y"] + p["h"], floor)
                    share = _open_stretch(p["y"], bottom, [(o["y"], o["y"] + o["h"]) for o in inside]) / max(1.0, bottom - p["y"])
                    if share > share_max:
                        _finding(found, "OF-115", "HIGH", s["n"], f"{share:.0%} of the panel that carries the title is empty",
                                 hint="Make the panel as tall as the title and its lines, standing on the page foot.")
                if p["y"] > tol and treatment == "statement" and p["w"] >= .9 * W and not any(o["y"] + o["h"] <= p["y"] + tol for o in content):
                    _finding(found, "OF-115", "HIGH", s["n"], "a plate under part of the page leaves the open page above it empty",
                             hint="Set the sentence on the whole-page field or on the open page; a plate needs content above it.")
    return found


# ── OF-116: another tonality of the same source draws another skeleton ─────
# The skeleton is each content slide's title zone and column partition, as OF-111 reads them. Two
# tonalities of one source with the same skeleton differ in colour only.

def skeleton(prs):
    return [s["signature"][:2] for s in read_slides(prs)[3] if s["role"] == "content"]


def compare_skeletons(path, sibling):
    """OF-116 for a deck and the same source compiled under another tonality (qa_deck.py --sibling)."""
    mine, other = skeleton(Presentation(str(path))), skeleton(Presentation(str(sibling)))
    n = min(len(mine), len(other))
    differ = sum(1 for a, b in zip(mine, other) if a != b)
    # Two slides once the deck has four content slides: one differing slide still reads as one deck in two colours.
    need = 2 if n >= 4 else 1
    found = []
    if n and differ < need:
        _finding(found, "OF-116", "HIGH", None, f"{differ} of {n} content slides differ in title zone or partition from {Path(sibling).name} (needs {need})",
                 hint="Give the tonality its own structure: its role defaults, another title zone or partition on the slides both decks share.")
    return found


# ── OF-117: no light figure card on a dark ground ───────────────────────────
# A chart or diagram exported on white reads as a white card with small grey labels on a dark ground.
# A figure is a picture of mostly near-white pixels; a photograph seldom is.

def light_figures(sn, slide, W, H):
    found = []
    try:
        rgb = slide.background.fill.fore_color.rgb if slide.background.fill.type == 1 else None
    except (AttributeError, TypeError, ValueError):
        rgb = None
    if rgb is None:
        return found
    r, g, b = (v / 255 for v in rgb)
    if .2126 * r + .7152 * g + .0722 * b > FIGURE_LIMITS["ground_max"]:
        return found
    from PIL import Image  # the office runtime's imaging library, needed only for a dark slide with a picture
    for s in slide.shapes:
        box = _pt(s) if s.shape_type == MSO_SHAPE_TYPE.PICTURE else None
        if not box or not FIGURE_LIMITS["min_area"] * W * H <= box[2] * box[3] < .8 * W * H:
            continue
        with Image.open(io.BytesIO(s.image.blob)) as im:
            raw = im.convert("RGB").resize((64, 64)).tobytes()
        share = sum(1 for i in range(0, len(raw), 3) if min(raw[i:i + 3]) >= FIGURE_LIMITS["near_white"]) / (len(raw) / 3)
        if share > FIGURE_LIMITS["share"]:
            _finding(found, "OF-117", "HIGH", sn, f"a light figure ({share:.0%} near-white) on a dark ground",
                     hint="Put the figure's dark variant beside it (name.dark.png) or draw it as a native chart.")
    return found


# ── OF-118: a run-in label keeps its separator ─────────────────────────────
# A point that opens with a bold label and runs on in regular weight reads as one sentence when nothing parts
# the two ("요약 앱에서 …"): the label takes a colon unless it ends in a separator of its own.
RUN_IN_SEPARATOR = re.compile(r"[:：.)\]?!–—\-]$")


def check_run_ins(sn, slide):
    found = []
    for shape in slide.shapes:
        if not getattr(shape, "has_text_frame", False) or shape.name.startswith(("title@", "lit-notice")):
            continue
        for paragraph in shape.text_frame.paragraphs:
            runs = [r for r in paragraph.runs if r.text]
            if len(runs) < 2 or not runs[0].font.bold or runs[1].font.bold:
                continue
            label, rest = runs[0].text.strip(), runs[1].text
            if not label or not re.search(r"\w", rest) or RUN_IN_SEPARATOR.search(label) or rest.lstrip()[:1] in ":：":
                continue
            _finding(found, "OF-118", "HIGH", sn, f"bold run-in label without a separator: {(runs[0].text + rest)[:40]}",
                     hint="Write the label with its colon (**요약:** …), or let the engine set it; never run a bold label into the sentence.")
    return found


# ── OF-119: no count numeral beside an agenda title ────────────────────────
# An agenda numbers its own rows; a numeral beside its title reads as a stray section number.

def agenda_numerals(slides):
    found = []
    for s in slides:
        if s["family"] == "agenda" and "kicker-numeral" in (s["drawn"], s["named"]):
            _finding(found, "OF-119", "HIGH", s["n"], "a numeral beside the agenda title repeats the count of its numbered rows",
                     hint="Give the agenda a title without a numeral; its rows carry the numbers.")
    return found


# ── OF-114: titles name a topic ─────────────────────────────────────────────
# Korean is read on its last word: a sentence ending or a nominalised claim makes a sentence.
# English is read for a closing period or a finite verb. A trailing parenthesis is set aside
# first, and a question or a quotation is never a claim.

KO_CLAIM = re.compile(r"(?:니다|[어아해세에예네지군래게]요|죠|[었았였했겠됐](?:다|음)|[가-힣]다|[가-힣](?:함|됨)|(?:있|없)음)$")
KO_NOUNS = {"바다", "판다", "소다", "람다", "캐나다", "어젠다", "아젠다", "포함", "보다", "함", "다"}
EN_FINITE = re.compile(r"\b(?:is|are|was|were|has|have|had|will|would|can|could|should|must|does|did|won't|isn't|aren't|wasn't|doesn't|didn't)\b", re.I)
EN_CLAIM_VERBS = set("""grew grows rose rises fell falls doubled doubles tripled triples halved halves increased increases
decreased decreases declined declines improved improves dropped drops climbed climbs beats outperforms outperformed leads
drives drove shows showed needs makes reached reaches exceeded exceeds missed misses stays stayed remains remained comes
came takes took works worked pays paid saves saved explains explained matters wins won lost loses cuts lifts lifted
slowed slows fails failed""".split())


def declarative_title(text):
    """True when a title or subtitle states a claim as a sentence instead of naming a topic."""
    t = re.sub(r"\s+", " ", str(text or "")).strip()
    t = re.sub(r"\s*\([^()]*\)$", "", t).strip().rstrip("\"'”’")
    if not t or t.endswith("?") or t[0] in "“\"「『‘'":
        return False
    if re.search(r"[가-힣]", t):
        last = re.sub(r"[.!…]+$", "", t.split(" ")[-1])
        return last not in KO_NOUNS and bool(KO_CLAIM.search(last))
    if t.endswith((".", "!")):
        return True
    return bool(EN_FINITE.search(t)) or any(w.lower() in EN_CLAIM_VERBS for w in re.findall(r"[A-Za-z']+", t)[1:])


def check_labels(prs):
    """OF-114 over every engine-drawn title and the cover subtitle."""
    found = []
    named = [(n, s) for n, slide in enumerate(prs.slides, 1) for s in slide.shapes
             if s.name.startswith(("title@", "subtitle@")) and getattr(s, "has_text_frame", False)]
    legacy = any(s.name == "title@legacy" for _, s in named)
    for n, s in named:
        text = re.sub(r"\s+", " ", s.text_frame.text).strip()
        if declarative_title(text):
            what = "subtitle" if s.name.startswith("subtitle@") else "title"
            _finding(found, "OF-114", "MEDIUM" if legacy else "HIGH", n, f"the {what} is a sentence: {text[:60]}",
                     hint="Name the topic as a label (분기별 매출 추이; Conversion by feed rate) and open the body with the claim.")
    return found
