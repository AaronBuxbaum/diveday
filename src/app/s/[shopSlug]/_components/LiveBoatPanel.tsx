import Link from "next/link";
import { BoatDrift } from "@/components/illustration/BoatDrift";
import { SiteMark } from "@/components/illustration/SiteMark";
import { SectionCard } from "@/components/ui/card";
import { groupLabelClass } from "@/components/ui/ledger";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import type { TripStage } from "@/lib/trip-stages";

/**
 * **A boat that is out says so on the shop's own website** — ADR
 * 20260904-reef-all-the-way-down, decision 2, Budget rule 4.
 *
 * The one place in this app where a live operational fact reaches an
 * anonymous visitor, which is why the narrowing is done at the query
 * (`liveShopStage`) and not here: a private charter is never named, a
 * cancelled or deleted departure is never named, and a boat that is *home* is
 * never published. This component renders what it is given and nothing else.
 *
 * It repeats what the crew said and when they said it. **Never a position** —
 * the ADR rejects tracking outright, and no coordinate reaches this props
 * shape to be leaked by a later edit.
 */
export function LiveBoatPanel({
  stage,
  sentence,
  eyebrow,
  meta,
  follow,
}: {
  stage: TripStage;
  /** "Mantis II is out on Molasses Reef." — composed server-side. */
  sentence: string;
  eyebrow: string;
  /** "The crew said so at 7:04 AM. Back around 11:30." */
  meta: string;
  /**
   * The door to this boat's own page (ADR 20260908-one-hand, decision 6,
   * lever U). Absent unless the shop turned the line on — the panel above it
   * is older than the switch and keeps speaking without one, because a stage
   * on the shop's own storefront is the shop's own page saying it.
   */
  follow?: { href: string; label: string };
}) {
  return (
    <SectionCard className="mt-6 max-w-md">
      <div className="flex items-start gap-4">
        <BoatDrift stage={stage}>
          <SiteMark mark="boat" size="sm" ground="tint" coral={false} />
        </BoatDrift>
        <div className="min-w-0">
          <p className={groupLabelClass()}>{eyebrow}</p>
          <p className={`mt-1 ${SECTION_TITLE_CLASS}`}>{sentence}</p>
          <p className="mt-1 text-sm text-muted tabular-nums">{meta}</p>
          {follow ? (
            // One quiet door, at link weight. A panel about a boat that is
            // already out is not a place for a button competing with the
            // page's one primary, which is the seat on the next departure.
            <Link
              href={follow.href}
              className="mt-2 inline-flex min-h-11 items-center font-medium text-primary hover:underline"
            >
              {follow.label}
            </Link>
          ) : null}
        </div>
      </div>
    </SectionCard>
  );
}
