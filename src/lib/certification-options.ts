/**
 * Certification agency codes, shared by the database enum and server-side
 * consumers. `src/db/schema.ts` builds its `pgEnum` from this array, so there
 * is one list: a widening lands in the enum, the zod
 * `z.enum(certificationAgency.enumValues)` parsers and the dropdown at once.
 * The order here is the order rendered, and `DIVER_CERTIFICATION_AGENCY_KEYS`
 * in `src/i18n/readiness-labels.ts` is typed `Record<CertificationAgency, ...>`,
 * so an agency without its translation is a compile error, not a blank option.
 */
export const CERTIFICATION_AGENCIES = [
  "padi",
  "ssi",
  "naui",
  "sdi",
  "tdi",
  "cmas",
  "raid",
  "gue",
  "bsac",
  "nss_cds",
  "nacd",
  "iantd",
  "other",
] as const;

/**
 * "I am not certified", the answer that is not a certification level: a value
 * the select accepts, never a rung on the five-rung ladder `certificationRank`
 * sorts and `trip-admission.ts` asserts against. No ordinal is stated here
 * because the option's position would drift if it moved.
 *
 * It lives here, import-free, rather than beside the parser in
 * `src/lib/dive-declaration.ts`, because that module reaches zod and
 * `./rate-limit` (`node:crypto`); a client component importing this one string
 * would pull a polyfilled crypto stack into the first load of the public diver
 * pages. `dive-declaration.ts` re-exports it, so there is one definition.
 *
 * The wire value is namespaced away from the level codes so nothing can
 * `as CertificationLevel` it by accident.
 */
export const NO_CERTIFICATION_ANSWER = "none_declared";
