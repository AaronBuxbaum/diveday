/**
 * **A dive participation note** (issue #4307; glossary "Dive participation
 * note"): what the crew said about whether one diver went in on one dive of
 * the day. A diver who stays aboard for dive two has no other fact for it:
 * roll call answers where people are, and an executed dive describes the
 * boat's day, not a seat's.
 *
 * Three states, and the third is the honest default:
 * - `dived` — the crew said this diver did this dive;
 * - `sat_out` — the crew said this diver stayed out of the water for it;
 * - `unknown` — nobody said, or somebody took back what they said. No note
 *   at all reads the same way.
 *
 * Never inferred. Boarded, not boarded and not back aboard are roll call's,
 * and none of them says whether somebody was in the water. A note informs only:
 * head count, roll call, readiness, medical holds and fly-safe never read it.
 *
 * Framework-free and value-only: `src/db/schema` builds the pgEnum from this
 * tuple and the person sheet's Client Component reads the type.
 */
export const DIVE_PARTICIPATIONS = ["dived", "sat_out", "unknown"] as const;

export type DiveParticipation = (typeof DIVE_PARTICIPATIONS)[number];

export function isDiveParticipation(value: unknown): value is DiveParticipation {
  return (DIVE_PARTICIPATIONS as readonly unknown[]).includes(value);
}
