# OCR Policy

Personal Knowledge RAG currently treats OCR as an explicit enterprise preprocessing step.

## Current Decision

- Automatic OCR is disabled in the desktop app.
- The app does not send PDFs or extracted content to external OCR services.
- Low-text-density PDFs are imported when text extraction succeeds, but import and reindex surface a structured `pdf_ocr_recommended` warning.
- Support bundles include `ocr_policy.json` and content-free document quality summaries so support staff can diagnose scan/image-PDF issues without raw documents.

## Classification

The app computes PDF text density as non-whitespace characters per page:

- `< 25`: strong OCR recommendation
- `25` to `< 80`: possible OCR recommendation; review the document quality before relying on answers
- `>= 80`: no OCR recommendation from density alone

These thresholds are diagnostics, not answer-confidence scores.

## Remediation

Use an enterprise-approved local or internal OCR tool to generate a searchable PDF, then reimport the file or run reindex. Keep the original document retention and approval process outside the app unless a future product decision approves a bundled local OCR engine.

## Criteria Before Bundled OCR

Before adding automatic or one-click local OCR, the product should have:

- approved licensing and packaging for macOS distribution
- offline-only execution with no external network dependency
- deterministic error reporting and support-bundle diagnostics
- language coverage validated on representative enterprise PDFs
- regression checks showing OCR improves retrieval without degrading citation traceability
