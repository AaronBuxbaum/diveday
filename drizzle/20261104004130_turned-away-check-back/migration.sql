-- Issue #2702: the check dropped before `booking_status` lost 'checked_in', put back over the new type.
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_turned_away_is_released" CHECK ("turned_away_at" is null or "status" in ('no_show', 'cancelled'));
