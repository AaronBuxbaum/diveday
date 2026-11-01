# H-20261013-incident-report-erasure: When a diver asks to be erased, what happens to an incident report that names them?

- **Status:** Open
- **Human owner:** Product owner + counsel

## Decision or approval needed

**Does erasing a diver keep the incident reports they are in, and how much of them?** An incident report (ADR [20261012-incident-reports](../../architecture/decisions/20261012-incident-reports.md)) is the shop's liability record: an insurer or a court may ask for it years later, and it describes other people too (the crew who responded, other divers who saw it). It is also personal and medical data about the diver: what happened to them, the first aid and oxygen they were given, and where they were taken. An erasure request pulls one way, the shop's legal hold the other. The options:

- **(a) Keep the report, remove the diver's identity** (built, the recommendation). The seat link stays and reads under the erased name; an outsider row carrying the name is redacted; every word-boundary match of the diver's full name in the narrative and the addenda becomes `[redacted]`. The medical facts stay, no longer attached to a name.
- **(b) Keep the report untouched**, as a legal hold that outranks the erasure request for its seven years. Strongest for the shop's defence; weakest for the diver.
- **(c) Redact every free-text field of every report the diver is linked to**, keeping only the yes/no answers and the times. Closes the residual below; leaves the shop a report that no longer says what happened.

## Recommendation

**(a).** The record a shop needs is that an incident happened, what was done and who did it; whose body it was matters less once the person has asked to be forgotten, and the seven-year window still ends it. The residual is stated rather than hidden: a nickname, a first name on its own, or a description ("the German couple's son") is not matched, a date and departure can still point at the person through the seat, and a parent or guardian written into a minor's report (in the narrative, the handover detail or an outsider row) is not one of the report's people and has no erasure path of their own; the seven-year window ends this residual too. Counsel may prefer (b) where a claim is open; that would be a per-report hold, a separate build.

## Also to confirm

- **The diver's own export** (`/divers/<id>` download) leaves incident reports out. A subject-access request may be owed them; the same counsel review as H-20260730-jurisdiction-waiver-text-medical/H-20260724-current-typed-name-explicit decides.
- **Seven years** from the incident is the retention window (`RETENTION_DAYS.incident_reports`), kept by the product owner over keeping reports for ever ([H-20261013-incident-report-retention](H-20261013-incident-report-retention.md), 2026-10-13). Some jurisdictions run a minor's limitation period from their 18th birthday, which can be longer.

## Minimum outcome to record

Which option, and whether the diver's own export should carry the reports.

## Unblocks / follow-up

The erasure sweep (`scrubIncidentReports`, `src/db/anonymize.ts`) and the export (`src/db/export-tables.ts`) change only if the answer is not (a).

Part of the [human decision log](README.md#decision-register).
