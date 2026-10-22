/**
 * How many upcoming trips the "book on an upcoming trip" picker scans. Some
 * of the scanned trips get filtered out below (already booked, full), so
 * this is generously larger than what the picker actually shows.
 */
export const BOOK_ACTIVITY_TRIP_SCAN_LIMIT = 50;
