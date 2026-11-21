# safety

The shop's safety practice outside the roll call: emergency reference, drills, incidents, shore
alerts, nitrox limits and advisories about a diver's experience.

## Owns

- `emergency-reference-page.ts`, `safety-drills.ts`, `safety-report/`, `incident-export.ts`,
  `shore-alert-tokens.ts`.
- Advisories: `mixed-training-advisory/`, `drysuit-experience.ts`, `nitrox-mod.ts`.

## Does not own

The manifest and roll call (`boarding`), the cert gate (`certifications`, `src/lib/readiness.ts`)
and medical holds (`waivers`).

## Invariants

- Only a verified nitrox card allows an EANx fill, enforced at write; only 22 to 40% O2 is
  accepted; MOD is derived from the mix and the ppO2 ceiling, never taken from the caller; a fill
  is append-only evidence.
- Safety-critical: boring code, failure-path tests, and a `dive-domain-expert` review.
