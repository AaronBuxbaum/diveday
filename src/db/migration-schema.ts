import { boolean } from "drizzle-orm/pg-core";
import { makeCourses } from "./schema";

export * from "./schema";

// Migration generation keeps this physical column for one release while the
// runtime reads `courses.included_rental_kinds` (issue #2796). The next release
// removes this override and generates the drop once this code is serving.
export const courses = makeCourses({
  retiringGearIncluded: boolean("gear_included").notNull().default(false),
});
