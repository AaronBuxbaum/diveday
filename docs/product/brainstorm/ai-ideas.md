# AI Ideas

Idea exploration, not commitments. This file holds brainstorm ideas that require AI, model-based
extraction, or natural-language generation. Nothing here is approved scope until it moves into
[roadmap.md](../roadmap.md) with a milestone, an ADR for the provider/dependency boundary, and the
right safety review.

AI guardrails:

- AI suggests; the safety spine decides.
- Low-confidence extraction fails closed.
- AI output on safety, medical, certification, nitrox, payments, or boarding surfaces must cite the
  underlying app state and stay reviewable by a human.
- No AI clears readiness, boarding, medical review, nitrox fill authorization, or refund/payment
  state.

## Diver And Staff Assistants

- **Diver-facing Q&A grounded in real state.** Answer questions like "Can I dive the wreck Saturday
  with Open Water?" from schedule and readiness logic. The answer can explain, but the readiness
  engine remains authoritative. *(L, cross-cutting, big bet.)*
- **Natural-language ops assistant.** Staff-only assistant for operational questions such as "Who is
  not ready for tomorrow's wreck trip?" Answers must cite the underlying app state. *(L,
  cross-cutting, big bet.)*

## Evidence Extraction

- **Cert-card OCR.** Extract agency, level, card number, and date from a card photo for staff to
  verify. Low confidence never clears a gate. *(M, certs, big bet.)*
