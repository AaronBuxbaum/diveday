# 20261024-diver-sent-doctors-form — A referred diver sends the signed doctor's form to a private column, not the shop's mailbox

- **Status:** Accepted
- **Date:** 2026-10-24
- **Amends:** [20261016-doctor-referral-page](20261016-doctor-referral-page.md)

## Context

The doctor's page told a referred diver to email a photo of the signed physician's form to the
shop's contact address: a medical document in a shared inbox, kept for ever, with no erasure.
Aaron chose a private upload (issue #2797, 2026-10-22), then its shape (2026-10-24): a new column
rather than relaxing `waiver_records_medical_clearance_attributed`, reads widened to the roles that
can record a clearance with every view audited, erasure and retention coverage. DiveDay still
decides nothing: staff record the physician's answer.

## Decision

- **Storage.** `storeMedicalClearanceDocument`, unchanged: the private `medical-clearances` prefix
  (no CloudFront behaviour), images decoded and re-encoded, PDFs proven by magic bytes, 5 MB cap.
  No new dependency.
- **Columns.** `waiver_records.diver_medical_form_url` and `diver_medical_form_sent_at`, outside
  the seal. `waiver_records_diver_medical_form_held` allows a URL only beside a sent time, on a
  referral, with no recorded answer.
- **Upload.** `sendDoctorFormAction` on `/waivers/[token]/doctor`: the waiver link is the
  authority; per-IP and per-diver (fail-closed) rate limits; type and size refused before storing;
  the page's own gate (`awaitsPhysician`, held seat, departure not over) checked before storing;
  one form per release, never replaced (`attachDiverMedicalForm`); a file the write refuses is
  queued for deletion. The action never returns the address.
- **Read.** `/api/medical-clearances/[recordId]/diver-form`, the evaluation route's twin:
  `canReadDiverMedicalForm` (every live staff role, the same as recording), shop-scoped, never an
  erased record, a 404 for every refusal, `attachment` and `no-store`, and a
  `diver_medical_form_opened` row on the diver's trail before the bytes go out.
- **Recording empties it.** The staffer may tick "Use the form the diver sent": it moves into
  `medical_clearance_document_url` and counts as evidence, behind that column's owner-or-manager
  read. Otherwise the copy on the answered release is queued for deletion.
- **Erasure, export, retention.** `anonymizeDiver` queues the file and nulls the URL; the sent
  time survives as a fact. The export carries `diver_medical_form_sent_at`, never the URL. Retention
  is the release's own (kept, pending H-02), and the column is empty once an answer is recorded.
- The return line leads with the upload; the shop's email or counter is the fallback.

## Alternatives considered

- **Relax the attributed check:** a document with no answer would read as staff evidence.
- **Owner-or-manager reads only:** the staffer recording the answer could not see the form.
- **A presigned URL:** a bearer link that outlives the role check.

## Consequences

The pre-decision read is wider than the evaluation's, briefly; the trail makes it checkable. A
form sent from a second seat's link is shown on the diver record and can be used for the answer, or
stays until that hold is answered or the diver erased. A wrong photo cannot be replaced from the
link; the diver uses the fallback. Revisit if uploads are abused (a
malware scan would be a new dependency and its own ADR), or if H-02 sets a retention clock.
