# H-51: A shop-authored pre-departure safety checklist (issue #686 — pre_departure_check_events, ADR 20260824-pre-departure-safety-check) ships informs-only: an…

- **Status:** Ready
- **Human owner:** Product owner

## Decision or approval needed

A shop-authored pre-departure safety checklist (issue #686 — `pre_departure_check_events`, ADR [20260824-pre-departure-safety-check](../../architecture/decisions/20260824-pre-departure-safety-check.md)) ships informs-only: an unchecked item never blocks a departure page, a boat from sailing, or any other surface. That stance matches every other "target, not a gate" in this app (`divemaster-ratio.ts`, the gear service clocks) and is deliberate rather than a placeholder — but the opposite argument (this is the one check that genuinely should be hard, since it is a legally specified vessel-safety kit in a way a divemaster ratio is not) deserves an owner's answer rather than an engineer's default.

## Minimum outcome to record

A yes or a no on whether an unchecked item should be able to refuse a departure from sailing (or from being marked complete), and if yes, at which surface(s) — the manifest, the schedule board, boarding itself.

## Unblocks / follow-up

No code is blocked on this — the checklist ships fully informs-only now, and every writer, reader, and UI tap target is agnostic to which way this resolves: a later gate would sit *above* `recordPreDepartureCheck`, not inside it.

Part of the [human decision log](README.md#decision-register).
