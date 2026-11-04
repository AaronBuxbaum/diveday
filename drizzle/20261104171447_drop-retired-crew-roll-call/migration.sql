-- Issue #3729: the retired crew roll-call table, its bridge trigger and function, one release after the fold into roll_call_events (#2700). The previous release declares none of them and nothing reads or writes the table; the trigger only forwarded a still-older release's writes during that deploy.
-- The trigger and function need no marker (the guard does not audit them).
-- diveday:allow-destructive drop-table roll_call_crew_events: crew marks are roll_call_events rows since the fold, whose rows were copied across
DROP TRIGGER "forward_retired_crew_roll_call" ON "roll_call_crew_events";--> statement-breakpoint
DROP FUNCTION "forward_retired_crew_roll_call"();--> statement-breakpoint
DROP TABLE "roll_call_crew_events";
