-- diveday:allow-destructive rename-type waiver_delivery_channel: pre-pilot, no shop has real divers (H-20260815-no-legacy); a serving release that writes 'text' fails one waiver delivery row until the deploy completes, and the next send retries
ALTER TYPE "waiver_delivery_channel" RENAME VALUE 'text' TO 'sms';
