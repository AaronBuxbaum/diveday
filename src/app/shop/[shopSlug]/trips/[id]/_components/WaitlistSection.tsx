import type { Waitlist } from "./types";
import { WaitlistInvite } from "./WaitlistInvite";

export function WaitlistSection({
  waitlist,
  shopSlug,
  tripId,
  shopName,
  tripTitle,
  tripWhen,
  inviteAction,
}: {
  waitlist: Waitlist;
  shopSlug: string;
  tripId: string;
  shopName: string;
  tripTitle: string;
  tripWhen: string;
  inviteAction: (entryId: string) => Promise<"sent" | "fallback">;
}) {
  const bookingPath = `/shop/${shopSlug}/schedule/${tripId}`;
  return (
    <section id="waitlist" className="mt-10 scroll-mt-6">
      <h2 className="text-lg font-semibold">
        Wait list <span className="font-normal text-muted tabular-nums">{waitlist.length}</span>
      </h2>
      <p className="mt-1 text-sm text-muted">
        These divers have not booked a seat and do not appear on the manifest. When one opens up,
        invite the next in line — one tap emails them the booking link.
      </p>
      {waitlist.length === 0 ? (
        <p className="mt-4 rounded-lg border border-border bg-surface px-4 py-6 text-center text-sm text-muted">
          No one’s waiting yet — when the trip sells out, divers can join the wait list from the
          public trip page.
        </p>
      ) : (
        <ol className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
          {waitlist.map(({ entry, person }, index) => (
            <li key={entry.id} className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
              <div className="flex min-w-0 items-start gap-3">
                <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 font-medium text-primary tabular-nums">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="font-medium">{person.fullName}</p>
                  <p className="text-muted">{person.email ?? "no email on file"}</p>
                </div>
              </div>
              <WaitlistInvite
                entryId={entry.id}
                personName={person.fullName}
                personEmail={person.email}
                invitedAt={entry.invitedAt}
                bookingPath={bookingPath}
                shopName={shopName}
                tripTitle={tripTitle}
                tripWhen={tripWhen}
                invite={inviteAction}
              />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
