CREATE TYPE "brand_display_font" AS ENUM('bricolage_grotesque', 'outfit', 'sora', 'playfair_display', 'archivo_black', 'lora');--> statement-breakpoint
ALTER TYPE "media_deletion_kind" ADD VALUE 'shop_hero';--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "brand_color" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "brand_display_font" "brand_display_font";--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "brand_hero_image_url" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "brand_hero_image_alt" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "established_year" integer;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "brand_badges" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_established_year_plausible" CHECK ("established_year" IS NULL OR ("established_year" >= 1900 AND "established_year" <= 2100));--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_brand_color_hex" CHECK ("brand_color" IS NULL OR "brand_color" ~ '^#[0-9a-f]{6}$');