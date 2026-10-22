CREATE TABLE "retention_prune_state" (
	"id" text PRIMARY KEY,
	"next_table" text NOT NULL,
	CONSTRAINT "retention_prune_state_singleton" CHECK ("id" = 'weekly')
);
