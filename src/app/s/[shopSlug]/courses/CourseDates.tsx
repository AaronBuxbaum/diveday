import Link from "next/link";
import { publicTripPath } from "@/lib/public-routes";
import { courseRowDates } from "./course-row-date";

export function CourseDates({
  sessions,
  shopSlug,
  ...format
}: {
  sessions: readonly { id: string; startsAt: Date; seatsLeft: number }[];
  shopSlug: string;
  locale: string;
  timeZone: string;
  t: import("@/i18n/messages").DiverTranslator;
}) {
  return sessions.length ? (
    <ul className="flex flex-wrap gap-x-6 pb-4">
      {courseRowDates({ ...format, sessions }).map((session) => (
        <li key={session.id}>
          <Link
            href={publicTripPath(shopSlug, session.id)}
            className="inline-flex min-h-11 items-center gap-2 text-base text-primary underline underline-offset-4"
          >
            {session.text}
            <span className="text-muted">
              {format.t("courses.index.seatsLeft", { count: session.seatsLeft })}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  ) : null;
}
