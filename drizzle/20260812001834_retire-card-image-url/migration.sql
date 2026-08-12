-- diveday:allow-destructive drop-column certifications.card_image_url: nothing reads or writes it. The upload went in ADR 20260804-card-evidence-is-the-number; the last two readers (the digital card, the specialty row's photo link) went in ADR 20260811-retire-the-digital-card, along with the `cardImageUrl` input on createCertification. No shop is live and no row holds a value, so there is no data to strand and no blob to orphan.
ALTER TABLE "certifications" DROP COLUMN "card_image_url";--> statement-breakpoint
-- diveday:allow-destructive drop-column specialty_certifications.card_image_url: the same column on the sibling table, dropped for the same reason and in the same release. See the note above.
ALTER TABLE "specialty_certifications" DROP COLUMN "card_image_url";
