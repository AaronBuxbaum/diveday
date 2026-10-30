/** Shared by server validation and client editors; kept outside `courses.ts`
 * so client code does not import its Zod validators. */
export const MAX_SCHEDULE_DAYS = 30;
export const MAX_SCHEDULE_DAY_ITEMS = 20;

/** Shared FAQ cap for server validation and the client editor. */
export const MAX_FAQS = 20;

/** Shared learning-material count and field limits for validation and editors. */
export const MAX_LEARNING_MATERIALS = 8;
export const LEARNING_MATERIAL_LIMITS = { name: 120, url: 500, note: 200 } as const;
