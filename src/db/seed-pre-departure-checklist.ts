// i18n-exempt-file: seeded demo shop's own checklist wording — DiveDay
// authors none of this (ADR 20260824-pre-departure-safety-check); it exists
// only so the shape reads on first look at the demo shop.
import type { DbExecutor } from "./client";
import { preDepartureChecklistItems } from "./schema";
import { at } from "./seed-clock";

/**
 * The demo shop wrote its checklist long before any departure it seeds: the
 * departure log reads the lines as they stood at each roll call (issue 2725),
 * so lines stamped at seed time would be missing from every seeded past count.
 */
const CHECKLIST_WRITTEN_DAYS_AGO = 3650;

/**
 * A realistic pre-departure line for a US day-boat operation — the set
 * AGENTS.md's own reading of an uninspected passenger vessel's legally
 * specified kit names (life jackets, a fire extinguisher, visual distress
 * signals, a sound device) plus the one every recreational operation is
 * expected to carry and have checked, emergency oxygen. A shop in a
 * different flag state writes its own; this is only the demo's own texture.
 */
export async function seedPreDepartureChecklist(db: DbExecutor, shopId: string): Promise<void> {
  const items = [
    "Emergency oxygen kit aboard and pressure checked",
    "Life jackets counted — one per person aboard",
    "Fire extinguisher aboard and charged",
    "Visual distress signals aboard and in date",
    "VHF radio checked",
  ];
  await db.insert(preDepartureChecklistItems).values(
    items.map((label, index) => ({
      shopId,
      label,
      sortOrder: index,
      createdAt: at(-CHECKLIST_WRITTEN_DAYS_AGO, 9),
    })),
  );
}
