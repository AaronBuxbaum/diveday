-- The walk-in seat line is retired with the walk-in door (Aaron, 2026-11-05): an add to a boat is
-- one act. Rows already written keep their meaning under the one code the incident export, the
-- roster-change log and the seat-sold alert read, so past seats stay in the departure record.
UPDATE "activity_events" SET "code" = 'seat_added' WHERE "code" = 'seat_added_walk_in';
