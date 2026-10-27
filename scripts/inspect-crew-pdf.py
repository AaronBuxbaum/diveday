"""Check actual Crew PDF pixels with PDFium and Poppler, rather than text alone.

Usage: python scripts/inspect-crew-pdf.py rota.pdf 'Shop name' 'Full week label'
Requires pypdfium2, Pillow and Poppler (pdftoppm / pdftotext).
This optional local inspector targets the English seeded Crew fixture.
Every sheet must contain the context and all seven weekdays; every extracted
word must have visible ink at its bounding box in both independent renderers.
The latter catches a repeated header present in text but missing on paper (#3094).
"""
import pathlib
import re
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

import pypdfium2 as pdfium
from PIL import Image

if len(sys.argv) < 4:
    raise SystemExit("Usage: python scripts/inspect-crew-pdf.py rota.pdf 'Shop name' 'Full week label'")
pdf_path = pathlib.Path(sys.argv[1]).resolve()
required = [*sys.argv[2:], "MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
normalize = lambda value: re.sub(r"\s", "", value).casefold()
failures = []
with tempfile.TemporaryDirectory(prefix="crew-pdf-") as folder:
    prefix = pathlib.Path(folder) / "page"
    subprocess.run(["pdftoppm", "-scale-to", "1500", "-png", str(pdf_path), str(prefix)], check=True, timeout=60, capture_output=True)
    xml = subprocess.run(["pdftotext", "-bbox", str(pdf_path), "-"], check=True, timeout=30, capture_output=True).stdout
    pages = ET.fromstring(xml).findall(".//{*}page")
    document = pdfium.PdfDocument(str(pdf_path))
    assert len(pages) == len(document), "PDFium and Poppler page counts differ"
    assert len(pages) >= 2, "Regression fixture must span multiple sheets"
    for number, (page, pdf_page) in enumerate(zip(pages, document), 1):
        words = page.findall("{*}word")
        text = normalize("".join(word.text or "" for word in words))
        for label in required:
            if normalize(label) not in text:
                failures.append(f"page {number}: missing context {label!r}")
        poppler_path = sorted(pathlib.Path(folder).glob("page-*.png"))[number - 1]
        individual_prefix = pathlib.Path(folder) / f"individual-{number}"
        subprocess.run(["pdftoppm", "-f", str(number), "-l", str(number), "-scale-to", "1500", "-png", str(pdf_path), str(individual_prefix)], check=True, timeout=30, capture_output=True)
        with pdfium.PdfDocument(str(pdf_path)) as individual_document:
            individual_page = individual_document[number - 1]
            individual_image = individual_page.render(scale=1500 / max(individual_page.get_size())).to_pil().convert("L")
            individual_page.close()
        images = {
            "Poppler batch": Image.open(poppler_path).convert("L"),
            "Poppler individual": Image.open(next(pathlib.Path(folder).glob(f"individual-{number}-*.png"))).convert("L"),
            "PDFium batch": pdf_page.render(scale=1500 / max(pdf_page.get_size())).to_pil().convert("L"),
            "PDFium individual": individual_image,
        }
        for renderer, image in images.items():
            scale = image.width / float(page.attrib["width"])
            for word in words:
                if not any(char.isalnum() for char in (word.text or "")):
                    continue
                box = tuple(float(word.attrib[key]) * scale for key in ("xMin", "yMin", "xMax", "yMax"))
                crop = image.crop((int(box[0]), int(box[1]), int(box[2]) + 1, int(box[3]) + 1))
                # A real glyph has several dark pixels even for small punctuation.
                ink = sum(count for shade, count in enumerate(crop.histogram()) if shade < 160)
                if ink < 2:
                    failures.append(f"page {number}, {renderer}: invisible word {word.text!r} at {box}")
        pdf_page.close()
    document.close()
assert not failures, "\n".join(failures)
print(f"{pdf_path.name}: {len(pages)} sheets, context and all words visible in PDFium and Poppler (batch and individual)")
