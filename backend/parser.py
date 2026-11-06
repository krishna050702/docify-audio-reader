import io
import re
from typing import Dict, List

import docx
import fitz  # PyMuPDF


def clean_extracted_text(text: str) -> str:
    """Removes broken hyphenations, bracketed citations [1, 2], and standalone page numbers."""
    text = re.sub(r"([a-zA-Z])-\n\s*([a-z])", r"\1\2", text)
    text = re.sub(r"\s*\[\d+(?:\s*[,–-]\s*\d+)*\]", "", text)
    text = re.sub(r"^\s*(?:page\s*)?\d+(?:\s*of\s*\d+)?\s*$", "", text, flags=re.IGNORECASE | re.MULTILINE)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def extract_pdf_layout_aware(file_bytes: bytes) -> Dict[str, any]:
    """
    Uses PyMuPDF (fitz) to extract text while ignoring top/bottom 7% page margins
    (where running headers, footers, and page numbers live) and detecting larger font sizes as Chapter Headings.
    """
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    output_lines: List[str] = []
    font_sizes: List[float] = []

    # First pass: compute median body font size
    for page in doc:
        blocks = page.get_text("dict").get("blocks", [])
        for b in blocks:
            for line in b.get("lines", []):
                for span in line.get("spans", []):
                    txt = span.get("text", "").strip()
                    if len(txt) > 3:
                        font_sizes.append(round(span.get("size", 11.0), 1))

    body_size = sorted(font_sizes)[len(font_sizes) // 2] if font_sizes else 11.0
    heading_threshold = body_size * 1.18

    # Second pass: extract clean blocks excluding top/bottom 7% header/footer zones
    for page in doc:
        page_height = page.rect.height
        top_margin = page_height * 0.07
        bottom_margin = page_height * 0.93

        blocks = page.get_text("dict").get("blocks", [])
        for b in blocks:
            bbox = b.get("bbox", [0, 0, 0, 0])
            y0, y1 = bbox[1], bbox[3]
            if y1 < top_margin or y0 > bottom_margin:
                continue

            block_text_parts: List[str] = []
            max_span_size = 0.0

            for line in b.get("lines", []):
                line_str = "".join(span.get("text", "") for span in line.get("spans", [])).strip()
                for span in line.get("spans", []):
                    if span.get("size", 0) > max_span_size:
                        max_span_size = span.get("size", 0)
                if line_str:
                    block_text_parts.append(line_str)

            full_block = " ".join(block_text_parts).strip()
            if not full_block:
                continue

            if max_span_size >= heading_threshold and len(full_block) < 95:
                output_lines.append(f"## {full_block}")
            else:
                output_lines.append(full_block)

    cleaned = clean_extracted_text("\n\n".join(output_lines))
    return {
        "pageCount": len(doc),
        "text": cleaned,
    }


def extract_docx_layout_aware(file_bytes: bytes) -> Dict[str, any]:
    """Extracts paragraphs and native Heading 1/2/3 styles from a Word (.docx) file."""
    document = docx.Document(io.BytesIO(file_bytes))
    output_lines: List[str] = []

    for para in document.paragraphs:
        raw = para.text.strip()
        if not raw:
            continue
        style_name = (para.style.name or "").lower()
        if "heading" in style_name or "title" in style_name:
            output_lines.append(f"## {raw}")
        else:
            output_lines.append(raw)

    cleaned = clean_extracted_text("\n\n".join(output_lines))
    return {
        "pageCount": max(1, len(output_lines) // 15),
        "text": cleaned,
    }
