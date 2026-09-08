-- diveday:allow-destructive drop-column inbound_messages.read_at: the column has never had a reader.
-- Its only production writer was markInboundAnswered stamping it alongside answered_at, and the
-- inbox built in #1507 groups messages as answered and unanswered, sorts by answered_at and counts
-- unanswered -- nothing on any surface ever distinguished read from unread. The one honest writer,
-- markPersonMessagesRead, had no caller outside its own test. Pre-pilot, no users, H-49.
ALTER TABLE "inbound_messages" DROP COLUMN "read_at";
