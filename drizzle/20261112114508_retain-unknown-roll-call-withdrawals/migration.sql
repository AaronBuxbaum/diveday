-- A retained untargeted withdrawal is uncertainty, not continued confirmation of
-- an earlier ashore/aboard statement. Read only the already validated canonical
-- frontier established by the preceding initializers; never infer observation
-- or meeting day from a capture, send or migration clock. Original audit fields
-- and exact target relations are immutable. Re-running this DML is harmless.
WITH affected AS (
  SELECT projection.id
  FROM roll_call_events projection
  WHERE NOT projection.evidence_conflict
    AND projection.effective_status <> 'cleared'
    AND NOT (projection.checkpoint <> 'departure' AND projection.effective_status = 'not_boarded')
    AND EXISTS (
      SELECT 1 FROM roll_call_events withdrawal
      WHERE withdrawal.shop_id = projection.shop_id
        AND withdrawal.trip_id = projection.trip_id
        AND withdrawal.subject_kind = projection.subject_kind
        AND withdrawal.booking_id IS NOT DISTINCT FROM projection.booking_id
        AND withdrawal.crew_person_id IS NOT DISTINCT FROM projection.crew_person_id
        AND withdrawal.checkpoint = projection.checkpoint
        AND withdrawal.meeting_day = projection.meeting_day
        AND withdrawal.statement_status = 'cleared'
        AND NOT withdrawal.reconciles_evidence
        AND projection.causal_frontier ? (
          CASE WHEN withdrawal.client_event_id IS NULL THEN 'server:' || withdrawal.id::text
            ELSE 'client:' || withdrawal.client_event_id::text END
        )
        AND NOT EXISTS (
          SELECT 1 FROM roll_call_events target
          WHERE target.id = withdrawal.retracts_event_id
            AND target.shop_id = withdrawal.shop_id
            AND target.trip_id = withdrawal.trip_id
            AND target.subject_kind = withdrawal.subject_kind
            AND target.booking_id IS NOT DISTINCT FROM withdrawal.booking_id
            AND target.crew_person_id IS NOT DISTINCT FROM withdrawal.crew_person_id
            AND target.checkpoint = withdrawal.checkpoint
            AND target.meeting_day = withdrawal.meeting_day
        )
    )
)
UPDATE roll_call_events projection SET effective_status = 'cleared'
FROM affected WHERE projection.id = affected.id;
