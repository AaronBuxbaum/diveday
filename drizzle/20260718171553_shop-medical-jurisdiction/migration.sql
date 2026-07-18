CREATE TYPE "medical_jurisdiction" AS ENUM('rstc', 'uk');--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "jurisdiction" "medical_jurisdiction" DEFAULT 'rstc'::"medical_jurisdiction" NOT NULL;