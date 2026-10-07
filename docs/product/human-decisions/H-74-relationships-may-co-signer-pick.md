# H-74: Which relationships may a co-signer pick, when only parent and legal_guardian exist?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**Which relationships may a co-signer pick, when only `parent` and `legal_guardian` exist?** Raised by the same `dive-domain-expert` review (#1541): a grandparent, stepparent, foster carer or a school group leader with eight children has to pick a code that is false, and free text was rejected in the ADR for reasons that still hold.

## Minimum outcome to record

Which codes, or a deliberate decision not to widen the list.

## Unblocks / follow-up

**Decided 2026-09-10 (Aaron Buxbaum, ready-for-human decision deck, issue #1541): leave the two codes.** A co-signer who is neither still picks one of the two, on paper as online — `recordInPersonWaiver` runs the same `isGuardianRelationship` check, so the paper path is not an escape hatch from the codes and this entry said otherwise until a `dive-domain-expert` pass on #1453 read the writer. What the paper path adds is the attesting staffer's name on the row beside the code. The accepted cost is a grandparent or foster carer filing under a code that is not quite theirs; revisit if a pilot shop reports it. `GUARDIAN_RELATIONSHIPS` is unchanged; the reasoning is in the glossary's **Guardian co-signature** entry.

Part of the [human decision log](README.md#decision-register).
