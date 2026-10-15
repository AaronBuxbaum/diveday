import type { getCourseBySlug } from "@/db/courses";

/** A course as the editor reads it: the row `getCourseBySlug` returns, never null. */
export type EditableCourse = NonNullable<Awaited<ReturnType<typeof getCourseBySlug>>>;
