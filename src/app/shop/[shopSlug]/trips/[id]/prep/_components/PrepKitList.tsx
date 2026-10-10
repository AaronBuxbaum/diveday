import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { buttonClass, tapTargetLinkClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { RowLink, Table, TBody, Td, THead, Th, Tr } from "@/components/ui/table";
import { FIGURE_CLASS, SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { rentalItemLabel } from "@/i18n/rental-labels";
import { type PrepGrouping, prepLineKey } from "@/lib/dive-prep";
import { scopedId } from "@/lib/element-id";
import { shopPath } from "@/lib/staff-notices";
import { diveRecencyLine, diverNames, kitCell, sizeCell } from "./prep-lines";
import type { PrepView } from "./prep-view";

/** The rental kit to pull, by item or by diver. */
export function PrepKitList({
  view,
  grouping,
  groupPath,
}: {
  view: PrepView;
  grouping: PrepGrouping;
  groupPath: string;
}) {
  const { prep, t, shopSlug, tripId, idPrefix } = view;
  const { checklist } = prep;
  // An empty packing table means one of two different things, and the rental-kit
  // empty state says which rather than making the crew scroll back up to guess.
  const needsSorting =
    checklist.diversWithIncompleteFit.length > 0 ||
    checklist.diversNeedingStaffFit.length > 0 ||
    checklist.heldSeats.length > 0;
  return (
    <section aria-labelledby={scopedId(idPrefix, "kit-heading")}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 id={scopedId(idPrefix, "kit-heading")} className={SECTION_TITLE_CLASS}>
          {t("tripPrep.rentalKitHeading")}
        </h2>
        {/* A state toggle, not two buttons: one list, two ways of
                  walking it (design principle 8). It only appears once there
                  is something to pull — with nothing on the list both
                  groupings render the identical empty state, and a control
                  that changes nothing is worse than no control. */}
        {checklist.lines.length > 0 ? (
          <SegmentedControl
            ariaLabel={t("tripPrep.groupLabel")}
            items={[
              {
                key: "item",
                label: t("tripPrep.groupByItem"),
                href: `${groupPath}?group=item`,
              },
              {
                key: "diver",
                label: t("tripPrep.groupByDiver"),
                href: `${groupPath}?group=diver`,
              },
            ]}
            currentKey={grouping}
            currentIsLink
            ariaCurrentValue="true"
            scroll={false}
            className="shrink-0"
          />
        ) : null}
      </div>
      {/* The boat's own vests, one per snorkeler seat (issue #2213):
                  not a rental, so it waits on no fit and is said even when
                  nothing else is pulled. */}
      {checklist.snorkelVests > 0 ? (
        <p className="mt-2 text-sm font-medium">
          {t("tripPrep.snorkelVests", { count: checklist.snorkelVests })}
        </p>
      ) : null}
      {checklist.lines.length === 0 ? (
        // A section inside a larger page, so h3. Two honest readings of
        // the same empty table — a genuine nothing-to-do, or fits that
        // were never recorded — and the Trip surface is where a fit gets
        // put on file either way.
        <EmptyState
          titleAs="h3"
          title={
            needsSorting
              ? t("tripPrep.rentalKitEmptyNeedsSortingHeading")
              : t("tripPrep.rentalKitEmptyOwnKitHeading")
          }
          body={
            needsSorting
              ? t("tripPrep.nothingToPullNeedsSorting")
              : t("tripPrep.nothingToPullOwnKit")
          }
          action={
            <Link
              href={shopPath(shopSlug, "trips", tripId)}
              className={buttonClass({
                variant: "secondary",
                size: "sm",
              })}
            >
              {t("tripPrep.rentalKitEmptyAction")}
            </Link>
          }
          className="mt-3"
        />
      ) : grouping === "item" ? (
        <>
          {/* Phone: stacked cards. Four columns at 390px put a
                    comma-joined diver list against three other columns and the
                    names win — the item, size, and count a staffer is actually
                    pulling gear by get squeezed to a character or two. Cards
                    under `sm`, the table above — the split the diver roster
                    also carried until it became one ledger at every width (ADR
                    20260827-people-not-lists); this list is the departure
                    surfaces' own call and stays. `print:` pins each half explicitly so the
                    printed packing list is the table at any paper width, not a
                    breakpoint coincidence. */}
          <ul className="mt-3 flex flex-col gap-3 sm:hidden print:hidden">
            {checklist.lines.map((line) => (
              <li key={`${line.kind}:${prepLineKey(line)}`} className={sectionCardClass()}>
                {/* `items-baseline`, in this card and the by-diver one:
                            top-aligned, the 24/32 count's baseline sat 6px
                            under the 16/24 title's (pixel-craft class 1). */}
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-semibold">{rentalItemLabel(t, line.kind)}</p>
                  <p className={`shrink-0 ${FIGURE_CLASS}`}>
                    <span className="sr-only">{t("tripPrep.qtyColumn")} </span>
                    {line.count}
                  </p>
                </div>
                {/* One grid for both pairs, each a subgrid row, so
                            both values start at the wider label plus 8px and a
                            long "For" list wraps in its own column: as two
                            flex rows the values stood 6px apart and the names
                            fell back under the label. */}
                <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 text-sm">
                  <div className="col-span-2 grid grid-cols-subgrid">
                    <dt className="text-muted">{t("tripPrep.sizeColumn")}</dt>
                    <dd>{sizeCell(t, line)}</dd>
                  </div>
                  <div className="col-span-2 grid grid-cols-subgrid">
                    <dt className="text-muted">{t("tripPrep.forColumn")}</dt>
                    <dd className="text-muted">{diverNames(line.divers)}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
          {/* The scroll strategy: the 40rem floor is what stops the four
                    columns collapsing between 640px and a real tablet, and the
                    vocabulary's `print:` overrides keep paper out of the
                    scroll rule entirely — an A4 sheet is narrower than the
                    floor, and a clipped column on a packing list is a silent
                    one. Not 45rem: that is 720px, and at 768 the trip shell's
                    column is 720px with a 718px scroll region inside the
                    table's borders, so the table scrolled sideways by 2px. */}
          <Table minWidth="40rem" shellClassName="mt-3 hidden sm:block print:block">
            <THead>
              {/* Pinned, the short Item column and the count, so Size
                          and For share the rest: with only the count pinned,
                          For held two names a line at 1280 and a fifth fell
                          alone onto a third. The fixed layout split four
                          unnamed columns equally, and a one-digit count held
                          244px. */}
              <Th width="10rem">{t("tripPrep.itemColumn")}</Th>
              <Th>{t("tripPrep.sizeColumn")}</Th>
              <Th numeric width="8rem">
                {t("tripPrep.qtyColumn")}
              </Th>
              <Th>{t("tripPrep.forColumn")}</Th>
            </THead>
            <TBody>
              {checklist.lines.map((line) => (
                <tr key={`${line.kind}:${prepLineKey(line)}`}>
                  <Td className="font-medium">{rentalItemLabel(t, line.kind)}</Td>
                  <Td>{sizeCell(t, line)}</Td>
                  <Td numeric>{line.count}</Td>
                  <Td muted>{diverNames(line.divers)}</Td>
                </tr>
              ))}
            </TBody>
          </Table>
        </>
      ) : (
        /* The same pieces down the roster instead of down the rack, for
                 the half of packing that happens per person — bagging a
                 diver's kit, or answering "what does this one still need?"
                 Every diver on the boat has a row, including the ones with
                 nothing to pull: a name whose answer is "own kit" is what
                 lets the packer stop looking for it. Same card-under-`sm`,
                 table-above split and the same `print:` pins as the by-item
                 view, so whichever grouping is on screen is what prints. */
        <>
          <ul className="mt-3 flex flex-col gap-3 sm:hidden print:hidden">
            {checklist.diverLines.map((line) => (
              <li key={line.bookingId} className={sectionCardClass()}>
                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {/* The card's 16px name: `nameLinkClass`'s floor,
                                  padding and handing back (44 − 24) / 2 of its
                                  own line, so a name that wraps keeps both. */}
                      <Link
                        href={`/shop/${shopSlug}/divers/${line.personId}`}
                        className={`${tapTargetLinkClass} py-2.5 -my-2.5 hover:text-primary hover:underline`}
                      >
                        {line.fullName}
                      </Link>
                    </p>
                    {diveRecencyLine(t, line.lastDivedBand)}
                  </div>
                  <p className={`shrink-0 ${FIGURE_CLASS}`}>
                    <span className="sr-only">{t("tripPrep.qtyColumn")} </span>
                    {line.items.length}
                  </p>
                </div>
                <div className="mt-2 text-sm">{kitCell(t, line)}</div>
              </li>
            ))}
          </ul>
          {/* Three columns rather than four, so a lower floor than the
                    by-item table's: the kit cell wraps, and forcing 40rem
                    would scroll a phone-width tablet sideways for nothing. */}
          <Table minWidth="36rem" shellClassName="mt-3 hidden sm:block print:block">
            <THead>
              <Th>{t("tripPrep.diverColumn")}</Th>
              <Th>{t("tripPrep.kitColumn")}</Th>
              <Th numeric width="8rem">
                {t("tripPrep.qtyColumn")}
              </Th>
            </THead>
            <TBody>
              {checklist.diverLines.map((line) => (
                // The row's one way in, and its only one: `RowLink`'s
                // overlay is positioned against `Tr`. Its 44px box
                // pads and hands (44 − 20) / 2 into the cell's `py-3`,
                // so the name keeps the kit's first line, the row its
                // height, and a wrapped name its second line clear of
                // the dive-recency note under it. `clip={false}` keeps
                // that overlay row-wide (a clipping cell bounds it to
                // itself, #1989); `break-words` wraps a long name the
                // dropped clip no longer cuts.
                <Tr key={line.bookingId}>
                  <Td clip={false} className="font-medium break-words">
                    <RowLink
                      href={`/shop/${shopSlug}/divers/${line.personId}`}
                      className="py-3 -my-3 hover:text-primary hover:underline"
                    >
                      {line.fullName}
                    </RowLink>
                    {diveRecencyLine(t, line.lastDivedBand)}
                  </Td>
                  <Td>{kitCell(t, line)}</Td>
                  <Td numeric>{line.items.length}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </>
      )}
    </section>
  );
}
