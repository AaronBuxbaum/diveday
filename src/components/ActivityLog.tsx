import { formatDateTimeTz } from "@/lib/format";

/**
 * One line of the shop's append-only trail. Deliberately structural rather than
 * the `activity_events` row type: the diver record and the Guests tab select
 * different columns off the same table, and neither needs the rest.
 */
export type ActivityLogEntry = { id: string; message: string; occurredAt: Date };

/**
 * The shop's own account of what has been done, rendered the one way.
 *
 * `message` arrives **already in the reader's language**. A row holds a code
 * and the names its sentence needs (`src/lib/activity.ts`), and the Server
 * Component above this one turns the pair into words through
 * `src/i18n/activity-labels.ts` — the staff bundle never crosses to the client,
 * so the resolution cannot happen here. Until issue #1655 the sentence was
 * built in `src/db` and printed verbatim, which meant a Spanish-speaking shop
 * read its own history in English all day.
 *
 * An erased diver's lines already read `[redacted]` in the table, rewritten
 * inside the erasure transaction (`src/db/anonymize.ts`) — there is no
 * read-time filter here, and there must not be one: a second copy of that rule
 * is the copy that gets forgotten.
 *
 * The timestamp names the shop's zone, like every other rendered instant in the
 * product — `formatDateTimeTz` takes `timeZone` as a required argument so
 * omitting it is a compile error rather than a four-hour lie on screen.
 */
export function ActivityLog({
  events,
  locale,
  timeZone,
  emptyText,
}: {
  events: readonly ActivityLogEntry[];
  locale: string;
  timeZone: string;
  emptyText: string;
}) {
  if (events.length === 0) return <p className="text-sm text-muted">{emptyText}</p>;
  return (
    <ol className="grid gap-2">
      {events.map((event) => (
        <li
          key={event.id}
          className="flex flex-col gap-x-4 gap-y-0.5 rounded-lg bg-surface-sunken px-4 py-3 text-sm sm:flex-row sm:items-baseline sm:justify-between"
        >
          <span className="min-w-0">{event.message}</span>
          <span className="shrink-0 text-muted tabular-nums">
            {formatDateTimeTz(event.occurredAt, locale, timeZone)}
          </span>
        </li>
      ))}
    </ol>
  );
}
