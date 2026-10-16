ALTER TABLE "shops" ADD COLUMN "bookkeeper_email" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "bookkeeper_email_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "bookkeeper_email_set_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "bookkeeper_sent_month" text;--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_bookkeeper_email_provenance" CHECK (("bookkeeper_email" is null and "bookkeeper_email_set_at" is null
        and "bookkeeper_email_set_by_person_id" is null)
        or ("bookkeeper_email" is not null and "bookkeeper_email_set_at" is not null
        and "bookkeeper_email_set_by_person_id" is not null));--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_bookkeeper_sent_month_shape" CHECK ("bookkeeper_sent_month" is null or "bookkeeper_sent_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');