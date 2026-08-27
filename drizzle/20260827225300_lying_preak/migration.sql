-- diveday:allow-destructive drop-column roll_call_crew_events.note: the roll-call note is deleted outright (#1058) -- no UI produced one on the live manifest, nothing reads the column, and pre-pilot there are no rows anyone would miss (H-49).
ALTER TABLE "roll_call_crew_events" DROP COLUMN "note";--> statement-breakpoint
-- diveday:allow-destructive drop-column roll_call_events.note: same deletion as the crew table above -- the writer, both schema keys and both surfaces went with it, so this column is written by nothing and read by nothing (#1058, H-49).
ALTER TABLE "roll_call_events" DROP COLUMN "note";
