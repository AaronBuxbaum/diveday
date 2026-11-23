// i18n-exempt-file: Spanish starter course content, the twin of course-templates.ts, not app UI copy.

import { COPY_ES_A1 } from "./part-a1";
import { COPY_ES_A2 } from "./part-a2";
import { COPY_ES_A3 } from "./part-a3";
import { COPY_ES_B1 } from "./part-b1";
import { COPY_ES_B2 } from "./part-b2";
import { COPY_ES_B3 } from "./part-b3";
import { COPY_ES_C1 } from "./part-c1";
import { COPY_ES_C2 } from "./part-c2";
import { COPY_ES_C3 } from "./part-c3";
import type { CourseTemplateCopyEs } from "./types";

/** The Spanish twin of every course template, by template slug (issue #4915). */
export const COURSE_TEMPLATE_COPY_ES: Record<string, CourseTemplateCopyEs> = {
  ...COPY_ES_A1,
  ...COPY_ES_A2,
  ...COPY_ES_A3,
  ...COPY_ES_B1,
  ...COPY_ES_B2,
  ...COPY_ES_B3,
  ...COPY_ES_C1,
  ...COPY_ES_C2,
  ...COPY_ES_C3,
};
