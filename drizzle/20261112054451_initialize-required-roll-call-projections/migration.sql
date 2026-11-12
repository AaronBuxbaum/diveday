-- Custom DML generated as an empty migration by drizzle-kit --custom.
-- Preserve original intent before materializing conservative legacy projections.
-- No timestamp establishes ancestry or a multi-day event's meeting day.
UPDATE roll_call_events e SET
  statement_status = e.status,
  meeting_day = CASE WHEN (SELECT count(*) FROM trip_schedule_days d WHERE d.trip_id = e.trip_id) > 1 THEN -1 ELSE 0 END
WHERE e.statement_status IS NULL;
--> statement-breakpoint
WITH retained AS (
  SELECT e.* FROM roll_call_events e
  WHERE NOT EXISTS (
    SELECT 1 FROM roll_call_events undo
    WHERE undo.shop_id = e.shop_id AND undo.trip_id = e.trip_id
      AND undo.subject_kind = e.subject_kind AND undo.checkpoint = e.checkpoint
      AND undo.booking_id IS NOT DISTINCT FROM e.booking_id
      AND undo.crew_person_id IS NOT DISTINCT FROM e.crew_person_id
      AND undo.statement_status = 'cleared' AND undo.retracts_event_id = e.id
  )
), scopes AS (
  SELECT shop_id, trip_id, subject_kind, booking_id, crew_person_id, checkpoint, meeting_day,
    max(seq) AS latest_seq
  FROM roll_call_events GROUP BY shop_id, trip_id, subject_kind, booking_id, crew_person_id, checkpoint, meeting_day
), projections AS (
  SELECT s.latest_seq,
    coalesce(jsonb_agg(coalesce(r.client_event_id, r.id)::text ORDER BY coalesce(r.client_event_id, r.id)::text) FILTER (WHERE r.id IS NOT NULL), '[]'::jsonb) AS frontier,
    count(DISTINCT r.statement_status) FILTER (WHERE r.statement_status <> 'cleared') > 1 AS conflict,
    CASE
      WHEN count(DISTINCT r.statement_status) FILTER (WHERE r.statement_status <> 'cleared') > 1 THEN
        CASE WHEN s.checkpoint = 'departure' THEN
          CASE WHEN bool_or(r.statement_status = 'boarded') THEN 'boarded' ELSE 'cleared' END
        ELSE CASE WHEN bool_or(r.statement_status = 'not_boarded') THEN 'not_boarded' ELSE 'cleared' END END
      ELSE coalesce(min(r.statement_status::text) FILTER (WHERE r.statement_status <> 'cleared'), 'cleared')
    END::roll_call_status AS effective
  FROM scopes s LEFT JOIN retained r ON
    r.shop_id = s.shop_id AND r.trip_id = s.trip_id AND r.subject_kind = s.subject_kind
    AND r.booking_id IS NOT DISTINCT FROM s.booking_id
    AND r.crew_person_id IS NOT DISTINCT FROM s.crew_person_id
    AND r.checkpoint = s.checkpoint AND r.meeting_day = s.meeting_day
  GROUP BY s.latest_seq, s.checkpoint
)
UPDATE roll_call_events e SET status = p.effective, causal_frontier = p.frontier,
  evidence_conflict = p.conflict, evidence_ordering_unknown = p.conflict
FROM projections p WHERE e.seq = p.latest_seq AND e.causal_frontier IS NULL;

--> statement-breakpoint
-- Earlier rows remain immutable statement evidence; the selected latest row
-- above carries the scope's complete active projection.
UPDATE roll_call_events SET causal_frontier = '[]'::jsonb WHERE causal_frontier IS NULL;
