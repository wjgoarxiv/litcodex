"""Generated Word fixtures for the two deterministic document checks."""
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'plugins/litcodex/skills/lit-docx/scripts'))
from docx_craft import audit_docx_office_floor  # noqa: E402


def make_doc(path, long=False, left=False):
    words = ('A long sentence for a wide page. ' * 12) if long else 'A short paragraph with a useful statement.'
    table_rows = []
    for index, values in enumerate((('Period', 'Amount'), ('Q1', '1,200'), ('Q2', '2,400'))):
        cells = []
        for col, value in enumerate(values):
            align = f'<w:pPr><w:jc w:val="{"left" if left else "right"}"/></w:pPr>' if index and col else ''
            cells.append(f'<w:tc><w:p>{align}<w:r><w:t>{value}</w:t></w:r></w:p></w:tc>')
        table_rows.append(f'<w:tr>{"".join(cells)}</w:tr>')
    document = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:rPr><w:sz w:val="{16 if long else 22}"/></w:rPr><w:t>{words}</w:t></w:r></w:p>
<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="3500"/><w:gridCol w:w="3500"/></w:tblGrid>{''.join(table_rows)}</w:tbl>
<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="576" w:bottom="720" w:left="576"/></w:sectPr>
</w:body></w:document>'''
    with ZipFile(path, 'w') as archive:
        archive.writestr('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
        archive.writestr('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
        archive.writestr('word/document.xml', document)
        archive.writestr('word/styles.xml', '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>')


class DocxOfficeFloor(unittest.TestCase):
    def test_measure_is_advisory(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'wide.docx'
            make_doc(path, long=True)
            findings = audit_docx_office_floor(path)
            self.assertTrue(any(f.rule_id == 'OF-301' and f.severity == 'MEDIUM' for f in findings))

    def test_numeric_alignment(self):
        with tempfile.TemporaryDirectory() as directory:
            poor, clean = Path(directory) / 'poor.docx', Path(directory) / 'clean.docx'
            make_doc(poor, left=True)
            make_doc(clean, left=False)
            self.assertTrue(any(f.rule_id == 'OF-302' and f.severity == 'HIGH' for f in audit_docx_office_floor(poor)))
            self.assertFalse(any(f.rule_id == 'OF-302' and f.severity == 'HIGH' for f in audit_docx_office_floor(clean)))


if __name__ == '__main__':
    unittest.main()
