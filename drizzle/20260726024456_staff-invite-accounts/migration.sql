ALTER TYPE "account_status" ADD VALUE 'invited' BEFORE 'active';--> statement-breakpoint
ALTER TYPE "account_token_purpose" ADD VALUE 'invite';