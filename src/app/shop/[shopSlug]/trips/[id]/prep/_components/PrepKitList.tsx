import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { buttonClass, tapTargetLinkClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { RowLink, Table, TBody, Td, THead, Th, Tr } from "@/components/ui/table";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { rentalItemLabel } from "@/i18n/rental-labels";
import { type PrepGrouping, prepLineKey } from "@/lib/dive-prep";
import { scopedId } from "@/lib/element-id";
import { shopPath } from "@/lib/staff-notices";
import { foldFitAtCheckIn } from "./fit-at-check-in";
import {
  diveRecencyLine,
  diverNames,
  KIT_PHONE_ROW_CLASS,
  kitCell,
  noLongerRented,
  pieceSize,
  sizeCell,
} from "./prep-lines";
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
  // "Fit at check-in" once per diver (B54): the by-item view's flagged
  // pieces regroup under each diver, every piece kept.
  const byItem = foldFitAtCheckIn(checklist.lines);
  const fitPieces = (pieces: (typeof byItem.fits)[number]["lines"]) =>
    pieces.map((piece, place) => (
      <span key={piece.kind}>
        {place > 0 ? ", " : null}
        {rentalItemLabel(t, piece.kind)}
        {piece.notOffered ? <> {noLongerRented(t)}</> : null}
      </span>
    ));
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
        {checklist.lines.length > 0 && !view.paper ? (
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
          {/* **Phone: one dense row per line, in one card** (UX review
                    2026-10-10, item 13). Each line was a card of its own with
                    a Size row and a For row, 23 of them and about 3,000px on a
                    seeded boat; the same three facts now share one row: the
                    piece and its size, who it is for, and how many. Four
                    table columns still do not fit 390px, so the names take
                    the row's middle and wrap there, never the piece or the
                    count. `print:` pins each half explicitly so the printed
                    packing list is the table at any paper width, not a
                    breakpoint coincidence. */}
          <ul
            className={sectionCardClass({
              padding: "none",
              className: "mt-3 divide-y divide-border overflow-hidden sm:hidden print:hidden",
            })}
          >
            {byItem.lines.map((line) => (
              <li
                key={`${line.kind}:${prepLineKey(line)}`}
                data-kit-line=""
                className={KIT_PHONE_ROW_CLASS}
              >
                <p>
                  <span className="font-semibold">{rentalItemLabel(t, line.kind)}</span>
                  {pieceSize(t, line) ? <> {pieceSize(t, line)}</> : null}
                </p>
                <p className="text-muted">{diverNames(line.divers)}</p>
                <p className="font-semibold tabular-nums">
                  <span className="sr-only">{t("tripPrep.qtyColumn")} </span>
                  {line.count}
                </p>
              </li>
            ))}
            {byItem.fits.map((row) => (
              <li key={`fit:${row.fullName}`} data-kit-line="" className={KIT_PHONE_ROW_CLASS}>
                <p className="font-medium text-warning">{t("tripPrep.fitAtCheckIn")}</p>
                <p>
                  <span className="font-semibold">{row.fullName}</span>{" "}
                  <span className="text-muted">{fitPieces(row.lines)}</span>
                </p>
                <p className="font-semibold tabular-nums">
                  <span className="sr-only">{t("tripPrep.qtyColumn")} </span>
                  {row.lines.length}
                </p>
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
              {byItem.lines.map((line) => (
                <tr key={`${line.kind}:${prepLineKey(line)}`}>
                  <Td className="font-medium">{rentalItemLabel(t, line.kind)}</Td>
                  <Td>{sizeCell(t, line)}</Td>
                  <Td numeric>{line.count}</Td>
                  <Td muted>{diverNames(line.divers)}</Td>
                </tr>
              ))}
              {/* One row per diver fitted in person: their pieces, said once. */}
              {byItem.fits.map((row) => (
                <tr key={`fit:${row.fullName}`}>
                  <Td className="font-medium">{fitPieces(row.lines)}</Td>
                  <Td>
                    <span className="font-medium text-warning">{t("tripPrep.fitAtCheckIn")}</span>
                  </Td>
                  <Td numeric>{row.lines.length}</Td>
                  <Td muted>{row.fullName}</Td>
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
          {/* One card of rows on a phone, as the by-item view above: a
                    diver's whole kit on one row under their name. */}
          <ul
            className={sectionCardClass({
              padding: "none",
              className: "mt-3 divide-y divide-border overflow-hidden sm:hidden print:hidden",
            })}
          >
            {checklist.diverLines.map((line) => (
              <li
                key={line.bookingId}
                data-kit-line=""
                className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 px-4 py-2.5 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-semibold">
                    {/* The row's name: the 44px floor (`tapTargetLinkClass`),
                        handing back (44 − 20) / 2 of its own line as padding
                        and margin, so a name that wraps keeps both. */}
                    <Link
                      href={`/shop/${shopSlug}/divers/${line.personId}`}
                      className={`${tapTargetLinkClass} py-2.5 -my-2.5 hover:text-primary hover:underline`}
                    >
                      {line.fullName}
                    </Link>
                  </p>
                  {diveRecencyLine(t, line.lastDivedBand)}
                  <div className="mt-0.5">{kitCell(t, line)}</div>
                </div>
                <p className="font-semibold tabular-nums">
                  <span className="sr-only">{t("tripPrep.qtyColumn")} </span>
                  {line.items.length}
                </p>
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
