/** Transient correction state cannot be replayed in another installation. */
export const FLY_SAFE_EXPORT_EXCLUSIONS = [
  "fly_safe_recipient_unknown", // unresolved local exposure
  "fly_safe_recipient_sealed", // encrypted local outbox recipient, cleared at erasure
  "fly_safe_hours_told", // what one night-before email said (#2927), kept only to correct it
  "fly_safe_corrected_at", // accepted or queued correction timestamp
  "fly_safe_correction_id", // delivery generation, meaningful only within the outbox
  "fly_safe_correction_attempts", // bounded local retry state
  "fly_safe_correction_lease_id", // temporary worker claim
  "fly_safe_correction_lease_until", // temporary worker claim expiry
];
