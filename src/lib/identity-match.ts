/**
 * Why a booking was attached to an existing diver on a guess (H-13): a reused
 * email under a different name, or a name a staffer picked off the counter's
 * "is this the same diver?" prompt. Mirrors the `identity_match_kind` pg enum.
 */
export type IdentityMatchKind = "shared_email" | "picked_name";
