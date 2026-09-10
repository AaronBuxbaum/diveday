"use client";

import { useState, useTransition } from "react";
import { ConnectivityStatus, type ConnectivityStatusCopy } from "@/components/ConnectivityStatus";
import { buttonClass } from "@/components/ui/button";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { scopedId } from "@/lib/element-id";
import type { SightingResult } from "../actions";

/**
 * The words this group needs, resolved on the server and handed down —
 * `staffTranslator` is server-side only, and each row's delete label
 * interpolates a species name.
 */
export type SeenGroupCopy = {
  heading: string;
  /** "At Molasses Reef. Divers read this on the trip page." — composed with the site. */
  consequence: string;
  delete: string;
  refusal: string;
  /** Said before the tap, while the device reports no connection. */
  offlineLabel: string;
  connectivity: ConnectivityStatusCopy;
};

/** One tappable face, and one already-tallied one. */
export type SeenChip = { slug: string; name: string };
export type SeenTally = SeenChip & { count: number; deleteLabel: string };

type SightingAction = (
  previous: SightingResult | undefined,
  formData: FormData,
) => Promise<SightingResult>;

/**
 * One tap, with its own pending state.
 *
 * **Its own, deliberately.** A single `useActionState` shared by the whole row
 * disabled every chip for the duration of any one round trip, and on a boat
 * with one bar that is a second or two per tap — long enough that a crew
 * naming two species in quick succession would have the second tap land on a
 * disabled control and be swallowed. Each chip owning its own transition means
 * two taps are two requests, and the tally below settles when they both land.
 *
 * The refusal is lifted to the group instead of living here: twelve chips each
 * able to grow their own error line is a wall of red on the surface with the
 * least room for one, and what a crew needs to know is that *a* tap did not
 * count.
 */
function SeenTap({
  name,
  slug,
  action,
  onResult,
  className,
  ariaLabel,
  children,
}: {
  name: string;
  slug: string;
  action: SightingAction;
  onResult: (result: SightingResult) => void;
  className: string;
  ariaLabel?: string;
  children: React.ReactNode;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <form
      action={(formData: FormData) => {
        startTransition(async () => {
          onResult(await action(undefined, formData));
        });
      }}
    >
      <input type="hidden" name="speciesSlug" value={slug} />
      <button
        type="submit"
        name={name}
        disabled={pending}
        aria-busy={pending}
        aria-label={ariaLabel}
        className={className}
      >
        {children}
      </button>
    </form>
  );
}

/**
 * **The Seen group — what this crew saw, tapped rather than typed.**
 *
 * One tap on a chip adds a sighting for this departure at this site; a second
 * tap on the same chip counts a second one, and the list underneath says the
 * count. That list is also the only feedback a tap gets, which is deliberate:
 * a chip that lit up *and* a row that appeared would be one act reported twice
 * on the surface with the least room for it.
 *
 * **The chip row does not move.** Species keep the order the server sent —
 * this site's field guide, then the shop's other picks — however many have been
 * logged. A row that floated tapped species to the front would rearrange itself
 * under a thumb that is mid-reach for the next one, and the tally below already
 * says what has been logged.
 *
 * **Where it sits, and why it is not anywhere else.** The manifest is a safety
 * instrument, and the roll call's commit path and the head-count panel are the
 * two things on it that must never share a screen region with an ornament. This
 * rides at the bottom of the *after-dive* view, directly under the dive log the
 * crew already fills in at the surface interval — the one part of the manifest
 * that is a record of what happened rather than a count of who is aboard. At
 * the dock checkpoint, and on a departure that has not sailed, it does not
 * render at all: there is nothing yet to have seen.
 *
 * **`print:hidden`, like every sibling after-dive control** (`TripPlanSection`,
 * `ExecutedDiveLog`, `CatchUpStrip`, `BuddyTeamsPanel`). The printed packet is
 * the fallback under the fallback — a sheet a crew carries when the phones are
 * gone — and a page of species buttons nobody can press is paper spent on an
 * ornament. The tally is on the trip page and in the shop's own export.
 *
 * **Boat targets and boat contrast.** 44px chips with `touch-manipulation`, and
 * the manifest's own ambient contrast control above them. A crew is doing this
 * with one wet hand on a moving deck, holding a tank with the other.
 *
 * `sm` rather than the 56px `boat` size, which is what a wrapping row of chips
 * takes by `buttonClass`'s own rule ("a ledger row, a table cell or a chip row
 * takes `sm`") — and the stage strip, the other tap-at-the-rail control on this
 * surface, is drawn the same way. It is also what makes the group fit: at 390px
 * a `boat` chip is wide enough that twelve species stack one per row, which is
 * seven hundred pixels of the manifest for an ornament. `touch-manipulation`
 * comes across by hand because `boat` is the only size that carries it, and the
 * 300ms double-tap-to-zoom wait is exactly what a *second* tap on one chip runs
 * into.
 *
 * It gates nothing, and every refusal is a fact about the tap rather than about
 * the reef.
 */
export function SeenGroup({
  idPrefix,
  chips,
  tallies,
  copy,
  recordAction,
  deleteAction,
}: {
  /** Scopes this section's element ids to one departure — see `scopedId`. */
  idPrefix?: string;
  /** The faces this reef offers, this site's guide first (`seenChipSlugs`). */
  chips: readonly SeenChip[];
  /** What this departure has logged here, most-seen first. */
  tallies: readonly SeenTally[];
  copy: SeenGroupCopy;
  recordAction: SightingAction;
  deleteAction: SightingAction;
}) {
  // One flag for the group, set by whichever tap answered last. A success
  // clears it, which is the honest reading: the boat has bars again.
  const [refused, setRefused] = useState(false);
  const onResult = (result: SightingResult) => setRefused(result.status === "error");
  const headingId = scopedId(idPrefix, "seen-heading");
  return (
    <section className="mt-8 print:hidden" aria-labelledby={headingId}>
      <h2 id={headingId} className={SECTION_TITLE_CLASS}>
        {copy.heading}
      </h2>
      {/* **Said before the tap, not only after it** (issue #1625). The surface
          interval between two tanks is when a crew taps these chips and it is
          also when a boat has no bars, so the refusal below was arriving at the
          only moment the group is ever used. This warns first.

          It does not replace the refusal, and that is the point rather than an
          oversight: `navigator.onLine` is the browser's flag, not reachability
          — a boat with one bar reports itself online and the write still fails.
          One of these two lines is a prediction and the other is a fact, and
          the crew needs both.

          The chips stay tappable underneath it. A dead chip on a wet deck reads
          as a broken app rather than as a missing bar, and the tap that goes
          through the moment a bar comes back is worth more than the one the
          disabled state would have swallowed. */}
      <ConnectivityStatus
        offlineLabel={copy.offlineLabel}
        onlyWhenOffline
        className="mt-2"
        copy={copy.connectivity}
      />
      <div className="mt-4 flex flex-wrap gap-2">
        {chips.map((chip) => (
          <SeenTap
            key={chip.slug}
            name="record"
            slug={chip.slug}
            action={recordAction}
            onResult={onResult}
            className={buttonClass({
              variant: "secondary",
              size: "sm",
              busy: true,
              className: "touch-manipulation",
            })}
          >
            {chip.name}
          </SeenTap>
        ))}
      </div>
      {/* The tally, which is the tap's whole answer — announced politely so a
          crew member working by voice hears the count move rather than having
          to go looking for it. */}
      {tallies.length > 0 ? (
        <ul className="mt-4 divide-y divide-border" aria-live="polite">
          {tallies.map((tally) => (
            <li key={tally.slug} className="flex min-h-14 items-center gap-3 py-2">
              <span className="min-w-0 flex-1 text-base font-medium">{tally.name}</span>
              <span className="text-base font-semibold tabular-nums">{tally.count}</span>
              <SeenTap
                name="delete"
                slug={tally.slug}
                action={deleteAction}
                onResult={onResult}
                ariaLabel={tally.deleteLabel}
                className={buttonClass({ variant: "danger-ghost", size: "sm", busy: true })}
              >
                {copy.delete}
              </SeenTap>
            </li>
          ))}
        </ul>
      ) : null}
      {/* The one line that earns its place: which reef these taps attach to,
          and that they are read outside the shop. Both are consequences the
          chips cannot show on their own. */}
      <p className="mt-2 text-sm text-muted">{copy.consequence}</p>
      {refused ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {copy.refusal}
        </p>
      ) : null}
    </section>
  );
}
