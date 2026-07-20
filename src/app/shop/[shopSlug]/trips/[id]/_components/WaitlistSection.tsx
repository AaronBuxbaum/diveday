import type { Waitlist } from "./types";

export function WaitlistSection({ waitlist }: { waitlist: Waitlist }) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold">
        Wait list <span className="font-normal text-muted tabular-nums">{waitlist.length}</span>
      </h2>
      <p className="mt-1 text-sm text-muted">
        These divers have not booked a seat and do not appear on the manifest.
      </p>
      {waitlist.length === 0 ? (
        <p className="mt-4 rounded-lg border border-border bg-surface px-4 py-6 text-center text-sm text-muted">
          No one is waiting for a spot yet.
        </p>
      ) : (
        <ol className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
          {waitlist.map(({ entry, person }, index) => (
            <li key={entry.id} className="flex items-start gap-3 px-4 py-3 text-sm">
              <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 font-medium text-primary tabular-nums">
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className="font-medium">{person.fullName}</p>
                <p className="text-muted">{person.email ?? "no email on file"}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
