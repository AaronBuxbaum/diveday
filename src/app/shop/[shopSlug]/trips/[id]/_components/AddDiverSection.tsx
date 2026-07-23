import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import type { BookableDiver } from "@/db/divers";
import { rentalFitLine } from "@/lib/dive-prep";

/**
 * Adding a diver leads with the shop's existing people so a returning diver is
 * *picked*, never re-typed — the "enter once, reuse everywhere" path that keeps
 * the roster from spawning a second person row and orphaning the first diver's
 * certs, waivers, and rental fit. The hand-entry form stays for a genuine
 * first-timer (and for wait-listing once a trip is full).
 */
export function AddDiverSection({
  shopSlug,
  full,
  query,
  candidates,
  addBookingAction,
  addToWaitlistAction,
  addExistingDiverAction,
}: {
  shopSlug: string;
  full: boolean;
  query: string;
  candidates: BookableDiver[];
  addBookingAction: (formData: FormData) => void;
  addToWaitlistAction: (formData: FormData) => void;
  addExistingDiverAction: (formData: FormData) => void;
}) {
  const searched = query.length > 0;
  return (
    <section id="add-diver" className="mt-10 scroll-mt-24">
      <h2 className="text-lg font-semibold">Add a diver</h2>

      {full ? (
        <p className="mt-1 text-sm text-muted">
          The boat is full — hand-entered divers go straight onto the wait list, no public booking
          page required.
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted">
            Search a returning diver to add them in one tap — their cards, waivers, and rental fit
            come along. New to the shop? Enter them by hand below.
          </p>

          {/* Server-fed search, same shape as the diver roster: a GET reload
              carries `diverq` and the section re-renders with matches. No client
              state, so the picker stays pixel-stable for Argos. */}
          <form method="get" className="mt-4 flex flex-wrap items-end gap-2">
            <Field label="Find a returning diver" className="min-w-0 flex-1">
              <input
                type="search"
                name="diverq"
                defaultValue={query}
                placeholder="Name, email, or phone"
                maxLength={120}
                autoComplete="off"
                className={controlClass}
              />
            </Field>
            <SubmitButton
              pendingLabel="Searching…"
              className={buttonClass({ variant: "secondary" })}
            >
              Search
            </SubmitButton>
          </form>

          {searched ? (
            candidates.length > 0 ? (
              <ul className="mt-4 grid gap-2">
                {candidates.map(({ person, rentalFit }) => {
                  const fit = rentalFitLine(rentalFit);
                  return (
                    <li
                      key={person.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-sm"
                    >
                      <div className="min-w-0">
                        <Link
                          href={`/shop/${shopSlug}/divers/${person.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {person.fullName}
                        </Link>
                        <p className="text-sm text-muted">{person.email ?? "no email on file"}</p>
                        {/* "Same as last time": the fit already on file carries
                            onto the trip, so staff confirm rather than re-enter. */}
                        <p className="mt-0.5 text-xs text-muted">
                          {rentalFit
                            ? `Rental fit on file · ${fit.text}`
                            : "No rental fit on file yet"}
                        </p>
                      </div>
                      <form action={addExistingDiverAction}>
                        <input type="hidden" name="personId" value={person.id} />
                        <SubmitButton
                          pendingLabel="Adding…"
                          ariaLabel={`Add ${person.fullName} to the trip`}
                          className={buttonClass({ size: "sm" })}
                        >
                          Add to trip
                        </SubmitButton>
                      </form>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-4 rounded-lg border border-border bg-surface px-4 py-4 text-center text-sm text-muted">
                No returning diver matches “{query}”. Enter them by hand below.
              </p>
            )
          ) : null}
        </>
      )}

      <details className="group mt-4" open={full || !searched}>
        {!full ? (
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center text-sm font-medium text-primary hover:underline [&::-webkit-details-marker]:hidden">
            New to the shop? Enter a diver by hand
          </summary>
        ) : null}
        <p className="mt-1 text-sm text-muted">
          For walk-ins or divers tracked in another system — puts them straight on the{" "}
          {full ? "wait list" : "manifest"}.
        </p>
        <form action={full ? addToWaitlistAction : addBookingAction} className="mt-4">
          <FieldGrid columns={3}>
            <Field label="Name">
              <input name="fullName" required maxLength={120} className={controlClass} />
            </Field>
            <Field label="Email">
              <input name="email" type="email" required maxLength={200} className={controlClass} />
            </Field>
            <Field label="Phone" hint="(optional)">
              <input name="phone" type="tel" maxLength={30} className={controlClass} />
            </Field>
          </FieldGrid>
          <FieldActions className="mt-4">
            <SubmitButton pendingLabel="Adding…" className={buttonClass()}>
              {full ? "Add to wait list" : "Add to trip"}
            </SubmitButton>
          </FieldActions>
        </form>
      </details>
    </section>
  );
}
