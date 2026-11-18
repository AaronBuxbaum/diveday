CREATE TABLE "rate_limit_buckets" (
	"key" text PRIMARY KEY,
	"tokens" double precision NOT NULL,
	"updated_at" bigint NOT NULL,
	"last_allowed" boolean NOT NULL
);
