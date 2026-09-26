import Link from "next/link";
import { Copyable } from "@/components/Copyable";
import { tapTargetLinkClass } from "@/components/ui/button";
import { TONE_PANEL_LG_CLASS } from "@/components/ui/card";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";

export type FirstBookableCardCopy = {
  heading: string;
  body: string;
  linkLabel: string;
  copy: string;
  copied: string;
  copyFailed: string;
  viewAsDiver: string;
};

/**
 * The moment a shop becomes bookable, said out loud. The first departure ever
 * landing on the board is the exact moment the first-run checklist — and the
 * public-schedule link it carried — disappears from Today, which used to make
 * the shop's biggest milestone read as a one-line "it's on the board" while
 * the link worth sharing silently vanished. This card replaces that notice
 * exactly once: the shareable link, a copy button, and the door to seeing the
 * page as a diver sees it. Subsequent trips get the ordinary notice; this
 * moment only happens once per shop.
 */
export function FirstBookableCard({
  scheduleUrl,
  scheduleHref,
  copy,
}: {
  /** Absolute when APP_HOST is configured; falls back to the bare path. */
  scheduleUrl: string;
  /** Always the path — what the in-app "see it" link navigates to. */
  scheduleHref: string;
  copy: FirstBookableCardCopy;
}) {
  return (
    // `mb-10`, the spine's own `gap-10` (`DaySpine`): the card is one more
    // block in the column it stands over, so it sits as far from the first
    // station as the stations sit from each other (K-316).
    <section
      aria-labelledby="first-bookable-heading"
      // The stations' `lg` inset, on the bed they sit on.
      className={`mb-10 ${TONE_PANEL_LG_CLASS} border-success/30 bg-success/5`}
    >
      <h2 id="first-bookable-heading" className={SECTION_TITLE_CLASS}>
        {copy.heading}
      </h2>
      <p className="mt-1 text-sm text-muted">{copy.body}</p>
      <Copyable
        className="mt-4"
        value={scheduleUrl}
        label={copy.linkLabel}
        copyLabel={copy.copy}
        copiedLabel={copy.copied}
        failedLabel={copy.copyFailed}
      />
      {/* **A 44px target on a 20px line** (K-452). The line is `h-5`, the
          text-sm line box, and centres the link's `tapTargetLinkClass` box on
          it, so the 12px of target above and below overhang the `mt-5` and the
          card's padding instead of stacking under the card's last line.
          `mt-5`, not `mt-3`: the box's top met the sunken panel's foot, and
          the 5px focus ring drew inside it. 20px leaves the box 8px under the
          panel and the ring 3px clear, as it is of the card's border below. */}
      <p className="mt-5 flex h-5 items-center text-sm">
        <Link
          href={scheduleHref}
          className={`${tapTargetLinkClass} font-medium text-primary hover:underline`}
        >
          {copy.viewAsDiver}
        </Link>
      </p>
    </section>
  );
}
