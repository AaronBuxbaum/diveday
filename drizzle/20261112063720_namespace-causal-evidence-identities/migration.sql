-- Custom derived-data migration generated with drizzle-kit --custom.
-- Independent server/client UUID namespaces must never alias causal evidence.
-- Raw statement identity, intent and audit metadata remain unchanged.
WITH scoped_refs AS (
  SELECT owner.id,
    coalesce(jsonb_agg(DISTINCT CASE WHEN target.client_event_id IS NULL
      THEN 'server:' || target.id::text ELSE 'client:' || target.client_event_id::text END)
      FILTER (WHERE target.id IS NOT NULL), '[]'::jsonb) AS frontier
  FROM roll_call_events owner
  LEFT JOIN LATERAL jsonb_array_elements_text(owner.causal_frontier) ref(value) ON true
  LEFT JOIN roll_call_events target ON target.shop_id = owner.shop_id
    AND target.trip_id = owner.trip_id AND target.subject_kind = owner.subject_kind
    AND target.booking_id IS NOT DISTINCT FROM owner.booking_id
    AND target.crew_person_id IS NOT DISTINCT FROM owner.crew_person_id
    AND target.checkpoint = owner.checkpoint
    AND target.meeting_day IS NOT DISTINCT FROM owner.meeting_day
    AND (ref.value = coalesce(target.client_event_id, target.id)::text
      OR ref.value = CASE WHEN target.client_event_id IS NULL
        THEN 'server:' || target.id::text ELSE 'client:' || target.client_event_id::text END)
  GROUP BY owner.id
)
UPDATE roll_call_events owner SET causal_frontier = scoped_refs.frontier
FROM scoped_refs WHERE owner.id = scoped_refs.id;
