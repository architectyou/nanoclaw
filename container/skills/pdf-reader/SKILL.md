---
name: pdf-reader
description: Read and extract text from PDF files using pdftotext
---

# PDF Reader

Extract text from PDF files. Use when the user asks to read, summarize, or analyze a PDF.

## Usage

```bash
# Extract text from a local PDF file
pdf-reader /path/to/file.pdf

# Download and extract text from a URL
pdf-reader fetch https://example.com/document.pdf

# Get PDF metadata (page count, title, etc.)
pdf-reader info /path/to/file.pdf
```

## Notes

- Only works with text-based PDFs. Scanned/image PDFs will return empty text.
- For large PDFs, extract specific pages: `pdf-reader /path/to/file.pdf 1-5`
- Downloaded PDFs are saved to the current directory.
