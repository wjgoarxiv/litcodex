"""Office craft checks over DOCX XML without a new runtime dependency."""
from __future__ import annotations

import re
import zipfile
from dataclasses import dataclass
from pathlib import Path
from xml.etree import ElementTree as ET

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
OF_LIMITS = {
    'latin_measure': 90, 'cjk_measure': 38, 'cjk_majority': .5,
    'latin_glyph_width': .55, 'cjk_glyph_width': 1.0,
    'default_font_pt': 11, 'numeric_share': .70, 'numeric_min_rows': 2,
}


@dataclass
class DocxFinding:
    rule_id: str
    line: int
    column: int
    section: str
    message: str
    excerpt: str
    severity: str
    tier: str = 'derived'


def _text(node):
    return ''.join(part.text or '' for part in node.iter(f'{W}t')).strip()


def _numeric(text):
    stripped = re.sub(r'[,\.\s%▲▼+\-±()$€£¥₩₹]', '', text.strip())
    return bool(stripped) and stripped.isdecimal()


def audit_docx_office_floor(path: Path) -> list[DocxFinding]:
    with zipfile.ZipFile(path) as archive:
        root = ET.fromstring(archive.read('word/document.xml'))
        try:
            styles = ET.fromstring(archive.read('word/styles.xml'))
        except KeyError:
            styles = None
    body = root.find(f'{W}body')
    if body is None:
        return []
    result = []
    section = body.find(f'{W}sectPr')
    page = section.find(f'{W}pgSz') if section is not None else None
    margins = section.find(f'{W}pgMar') if section is not None else None
    if page is not None and margins is not None:
        width = (int(page.get(f'{W}w', '12240')) - int(margins.get(f'{W}left', '1440')) - int(margins.get(f'{W}right', '1440'))) / 1440
    else:
        width = 6.5
    normal_size = OF_LIMITS['default_font_pt']
    if styles is not None:
        for style in styles.findall(f'{W}style'):
            if style.get(f'{W}styleId') == 'Normal':
                size = style.find(f'.//{W}sz')
                if size is not None:
                    normal_size = int(size.get(f'{W}val', '22')) / 2
                break
    for paragraph in body.findall(f'{W}p'):
        text = _text(paragraph)
        if not text:
            continue
        sizes = [int(node.get(f'{W}val')) / 2 for node in paragraph.findall(f'.//{W}sz') if node.get(f'{W}val')]
        font_pt = max(sizes, default=normal_size)
        cjk = sum('\uac00' <= char <= '\ud7a3' for char in text) / len(text) >= OF_LIMITS['cjk_majority']
        estimate = width * 72 / (font_pt * OF_LIMITS['cjk_glyph_width' if cjk else 'latin_glyph_width'])
        ceiling = OF_LIMITS['cjk_measure' if cjk else 'latin_measure']
        if estimate > ceiling:
            result.append(DocxFinding('OF-301', 0, 0, 'DOCX', f'Estimated {estimate:.1f} characters per line exceeds {ceiling}', text[:80], 'MEDIUM'))
    for table in body.findall(f'{W}tbl'):
        rows = table.findall(f'{W}tr')[1:]
        if len(rows) < OF_LIMITS['numeric_min_rows']:
            continue
        columns = max((len(row.findall(f'{W}tc')) for row in rows), default=0)
        for index in range(columns):
            cells = [row.findall(f'{W}tc')[index] for row in rows if len(row.findall(f'{W}tc')) > index]
            candidates = [cell for cell in cells if _text(cell)]
            if not candidates or sum(_numeric(_text(cell)) for cell in candidates) / len(candidates) < OF_LIMITS['numeric_share']:
                continue
            for cell in cells:
                if not _numeric(_text(cell)):
                    continue
                for paragraph in cell.findall(f'{W}p'):
                    align = paragraph.find(f'./{W}pPr/{W}jc')
                    if align is None:
                        result.append(DocxFinding('OF-302', 0, index + 1, 'DOCX', 'Numeric alignment inherited; not verified', _text(cell)[:80], 'MEDIUM'))
                    elif align.get(f'{W}val') != 'right':
                        result.append(DocxFinding('OF-302', 0, index + 1, 'DOCX', 'Numeric cell is explicitly not right aligned', _text(cell)[:80], 'HIGH', 'measured'))
    return result
