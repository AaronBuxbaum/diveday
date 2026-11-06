-- diveday:allow-destructive drop-table deck_counts: the Count on deck feature is removed (Aaron, 2026-11-05); the previous release only fails a deck count typed during the deploy itself, which the captain retypes; pre-pilot, no users (H-20260815-no-legacy)
DROP TABLE "deck_counts";
