"use client";

import { useActionState } from "react";
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
};

/** One tappable face, and one already-tallied one. */
export type SeenChip = { slug: string; name: string };
export type SeenTally = SeenChip & { count: number; deleteLabel: string };

/**
 * **The Seen group — what this crew saw, tapped rather than typed.**
 *
 * One tap on a chip adds a sighting for this departure at this site; a second
 * tap on the same chip counts a second one, and the list underneath says the
 * count. That list is also the only feedback a tap gets, which is deliberate:
 * a chip that lit up *and* a row that appeared would be one act reported twice
 * on the surface with the least room for it.
 *
 * **Where it sits, and why it is not anywhere else.** The manifest is a safety
 * instrument, and the roll call's commit path and the head-count panel are the
 * two things on it that must never share a screen region with an ornament. This
 * rides at the bottom of the *after-dive* view, directly under the dive log the
 * crew already fills in at the surface interval — the one part of the manifest
 * that is a record of what happened rather than a count of who is aboard. At
 * the dock checkpoint it does not render at all, because there is nothing yet
 * to have seen.
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
  recordAction: (
    previous: SightingResult | undefined,
    formData: FormData,
  ) => Promise<SightingResult>;
  deleteAction: (
    previous: SightingResult | undefined,
    formData: FormData,
  ) => Promise<SightingResult>;
}) {
  const [recorded, record, recording] = useActionState(recordAction, undefined);
  const [removed, remove, removing] = useActionState(deleteAction, undefined);
  const headingId = scopedId(idPrefix, "seen-heading");
  const refused = recorded?.status === "error" || removed?.status === "error";
  return (
    <section className="mt-8" aria-labelledby={headingId}>
      <h2 id={headingId} className={SECTION_TITLE_CLASS}>
        {copy.heading}
      </h2>
      <div className="mt-4 flex flex-wrap gap-2">
        {chips.map((chip) => (
          <form action={record} key={chip.slug}>
            <input type="hidden" name="speciesSlug" value={chip.slug} />
            <button
              type="submit"
              disabled={recording}
              aria-busy={recording}
              className={buttonClass({
                variant: "secondary",
                size: "sm",
                busy: true,
                className: "touch-manipulation",
              })}
            >
              {chip.name}
            </button>
          </form>
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
              <form action={remove}>
                <input type="hidden" name="speciesSlug" value={tally.slug} />
                <button
                  type="submit"
                  disabled={removing}
                  aria-busy={removing}
                  aria-label={tally.deleteLabel}
                  className={buttonClass({ variant: "danger-ghost", size: "sm", busy: true })}
                >
                  {copy.delete}
                </button>
              </form>
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
