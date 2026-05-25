# OCR Policy

Personal Knowledge RAG currently treats OCR as an explicit enterprise preprocessing step.

## Current Decision

- Automatic OCR is disabled in the desktop app.
- The app does not send PDFs or extracted content to external OCR services.
- Low-text-density PDFs are imported when text extraction succeeds, but import and reindex surface a structured `pdf_ocr_recommended` warning.
- Import preflight records PDF candidate counts before parsing; OCR need is still determined after text extraction because it depends on page-level extracted text density.
- Support bundles include `ocr_policy.json` and content-free document quality summaries so support staff can diagnose scan/image-PDF issues without raw documents.
- `ocr_policy.json` schema v2 includes the acceptance criteria below so support and release reviewers can see why bundled OCR is not enabled yet.

## Classification

The app computes PDF text density as non-whitespace characters per page:

- `< 25`: strong OCR recommendation
- `25` to `< 80`: possible OCR recommendation; review the document quality before relying on answers
- `>= 80`: no OCR recommendation from density alone

These thresholds are diagnostics, not answer-confidence scores.

## Remediation

Use an enterprise-approved local or internal OCR tool to generate a searchable PDF, then reimport the file or run reindex. Keep the original document retention and approval process outside the app unless a future product decision approves a bundled local OCR engine.

## Criteria Before Bundled OCR

Bundled OCR is a product and release decision, not just an implementation task. Before adding automatic or one-click local OCR, every release-gated item below must be satisfied.

| ID | Requirement | Validation | Release gate |
|----|-------------|------------|--------------|
| `licensing_and_distribution` | OCR engine licensing allows bundled macOS enterprise desktop distribution. | Record license, model/data redistribution terms, and attribution requirements in release notes. | Yes |
| `offline_only_execution` | OCR runs fully locally with no external network calls or document upload path. | Run a network-denied smoke test and inspect logs/support bundle diagnostics for no outbound OCR dependency. | Yes |
| `structured_failures` | OCR failures surface structured `stage`/`code`/`message`/`suggestion`/`retryable` diagnostics. | Add unit or integration tests for unreadable PDF, timeout, permission denied, and engine unavailable cases. | Yes |
| `language_quality` | OCR quality is validated on representative Chinese and mixed Chinese/English enterprise PDFs. | Compare extracted text density, garbled-text warnings, and sample citation readability before and after OCR. | No, but required before enablement |
| `citation_traceability` | OCR output preserves page-level citation traceability and citation-first answers. | Run product RAG gates and at least one scanned-PDF fixture with page/citation assertions. | Yes |
| `supportability_and_privacy` | Support bundles diagnose OCR state without exporting raw document images or extracted full text by default. | Verify support bundle privacy tests and runbook coverage for OCR engine/version/status fields. | Yes |
| `upgrade_and_rollback` | OCR-generated indexes have a safe reindex, cleanup, and rollback story across app upgrades. | Document migration/rollback steps and add a regression check for reindexing OCR-derived documents. | Yes |

Until those gates are satisfied, keep OCR as external enterprise preprocessing and rely on local diagnostics, repair actions, and support bundles to guide users.
