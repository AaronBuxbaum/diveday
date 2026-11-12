// Bound the complete screenshot inventory across publisher, capture manifest and baseline.
// Raising the old 2000-image budget to 3072 keeps three full image copies (9216 files)
// below the bundle's unchanged 10000-file ceiling, with room for report assets.
// This is a global budget: duration-balanced shards need not have equal image counts.
export const MAX_SCREENSHOTS = 3_072;
// A test may plan several screenshots; its independent plan budget remains unchanged.
export const MAX_CAPTURE_TEST_IDS = 2_000;
export const MAX_TOTAL_IMAGE_BYTES = 2_000_000_000;
