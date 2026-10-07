# H-94: May the public pages say the roll call works with no signal before the…

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**May the public pages say the roll call works with no signal before the boat test?** The launch plan held every offline roll-call claim until V-02, the outdoor test of the manifest on a boat, passed ([rollout.md](../rollout.md) §0.3), and the 2026-08-02 review flagged the claim, already live, as breaking that rule (MKT-F10, waiting on V-02 since). It still ran on the homepage, `/product`, `/pricing`, `/privacy`, `/about` and the switching guides, the demo shows it working, and the 2026-10-05 rework (H-93) repeats it on the homepage's roll-call step and the boat manifest page with its condition beside it.

## Minimum outcome to record

Keep the claim before V-02, or take it off every page until a boat day passes.

## Outcome

**Decided 2026-10-06 (Aaron Buxbaum, on the decision card in the H-93 thread): keep it.** The pages keep saying the roll call works with no signal, worded as the claims policy's offline rule requires: where a page explains it, it states the condition (the copy is saved to the phone while it has signal, and out of range a phone shows only its own taps), and no page says the roll call has been tested on a boat until V-02 records that it was. V-02 still gates the pilot ([rollout.md](../rollout.md)'s Phase 0 exit), and if it fails the claim comes off every page. Settles MKT-F10. Recorded in [rollout.md](../rollout.md) §0.3 and [marketing.md](../marketing.md#claims-policy-hard-rules)'s claims policy.

## Unblocks / follow-up

Nothing waits on it; V-02 itself is unchanged.

Part of the [human decision log](README.md#decision-register).
