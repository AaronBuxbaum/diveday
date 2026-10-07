CREATE TABLE "sms_opt_outs" (
	"phone" text PRIMARY KEY,
	"opted_out" boolean NOT NULL,
	"keyword_at" timestamp with time zone NOT NULL
);
