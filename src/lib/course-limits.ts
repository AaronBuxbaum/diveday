/**
 * Caps enforced both by `src/lib/courses.ts` and by DayByDayEditor's "Add day"
 * and "Add item" buttons, so a save can never build a schedule the server would
 * reject.
 *
 * They sit in their own module because those editors are `"use client"`, and
 * while these numbers lived beside the zod parsers in `courses.ts`, reading them
 * put a 375,158-byte (83.5 KB gzipped) zod chunk in the course-editor route's
 * browser bundle. `courses.ts` re-exports them, so nothing else moved.
 */
export const MAX_SCHEDULE_DAYS = 30;
export const MAX_SCHEDULE_DAY_ITEMS = 20;

/** Cap enforced both by `src/lib/courses.ts` and by `FaqEditor`'s "Add question" button. */
export const MAX_FAQS = 20;
