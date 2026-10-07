# H-46: Where does DiveDay sit between data minimisation and feature completeness while it is pre-pilot?

- **Status:** Chosen
- **Human owner:** Product owner

## Decision or approval needed

Where does DiveDay sit between data minimisation and feature completeness while it is pre-pilot? Raised 2026-08-14 by the offline crew roll call: making the crew half of a head count recordable with no signal requires crew **person ids** inside the encrypted snapshot retained on crew devices, and that snapshot's payload is an explicit allow-list precisely because a deny-list once leaked H-21's `age`/`minor`/`birthday` to every crew phone for up to fourteen days. The narrower question was whether to accept that; the general one is which way to lean when the two pull apart.

## Minimum outcome to record

A stated default for agents to build against, so the question is not re-litigated per feature.

## Unblocks / follow-up

**Decided 2026-08-14 (Aaron Buxbaum): lean toward the fuller feature.** Crew person ids may enter the offline snapshot, and more generally, while DiveDay is pre-pilot, a better and more complete feature beats a tighter minimisation posture when the two conflict. This is a **default, not a licence**: it settles what to do when a feature needs a field, and it does not touch the properties that are structural rather than conservative — tenant isolation, the write-only backup uploader, capability-URL redaction, medical answers staying off logs and analytics, and anything a published page now asserts (`/privacy`). Nor does it reverse H-02: retention windows and the erasure path are unchanged. **What it does change is the burden of proof.** An agent that finds a minimisation comment standing between it and the feature the owner asked for should build the feature and say so in the PR, rather than narrowing the feature to preserve the comment. Revisit when a real shop's divers are in the system — a pilot changes who bears the cost of this default. Consumed immediately by the offline crew roll call (`OfflineManifestSnapshot.crew[].id`). The allow-list in `src/lib/offline-manifests.ts` stays an allow-list — this decision adds one field to it deliberately, which is the allow-list working as intended rather than being abandoned.

Part of the [human decision log](README.md#decision-register).
