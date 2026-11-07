import type { ReactNode } from "react";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { PACKET_PAPER } from "@/lib/print-sheets";
import { ShopSheet } from "../../../../print/_components/ShopSheet";

/**
 * **The Boat tab on paper** (issue #2745): what the live manifest prints, and
 * the only thing it prints. The screen (count panel, stage strip, checkpoint
 * switch, row panels, buddy builder, device settings) never reaches a
 * printer; this sheet is drawn under it, shown only to the printer
 * (`data-paper-print-only`), and on paper a page holding a sheet is its
 * sheets (`globals.css`).
 *
 * Its body is the packet's manifest paper (`ManifestPaper`), composed by the
 * page from the same view the screen reads, so paper is the checkpoint the
 * captain is looking at: a diver recorded not back aboard after a dive prints
 * as such, in manifest order. After a dive the sheet also states what the
 * crew logged for it (`diveLog`), which the screen keeps behind a disclosure.
 */
export function BoatTabSheet({
  shop,
  shopSlug,
  name,
  printed,
  departure,
  status = [],
  diveLog,
  children,
}: {
  shop: { name: string; brandColor: string | null };
  shopSlug: string;
  /** "Manifest", at the band's far end. */
  name: string;
  printed: string;
  /**
   * Which departure: its title, then its date and zone, then the boat and the
   * checkpoint. In the body, because Safari never draws the page margin that
   * also carries it, and two boats' sheets must not read the same (#2745).
   */
  departure: readonly string[];
  /**
   * What the screen's count panel and warnings say and paper cannot: the
   * back-aboard tally, a dive before still open, a later count with someone
   * missing (`boatSheetStatus`, issue #4067). Empty at the dock.
   */
  status?: readonly string[];
  /** The checkpoint's logged dive, after a dive; null at the dock. */
  diveLog: { heading: string; line: string } | null;
  children: ReactNode;
}) {
  return (
    <div className="paper-sheet-frame" data-paper-print-only="">
      <div>
        <ShopSheet
          paper={PACKET_PAPER}
          shop={shop}
          shopSlug={shopSlug}
          name={name}
          printed={printed}
        >
          {departure.length > 0 ? (
            <header className="mb-6 border-b border-border pb-4">
              <h1 className="font-brand-display text-xl leading-tight font-extrabold">
                {departure[0]}
              </h1>
              {departure.slice(1).map((line) => (
                <p key={line} className="mt-1 text-sm">
                  {line}
                </p>
              ))}
            </header>
          ) : null}
          {status.length > 0 ? (
            <div className="mb-5 space-y-1 text-base font-bold">
              {status.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          ) : null}
          {children}
          {diveLog ? (
            <section className="mt-10">
              <h2 className={SECTION_TITLE_CLASS}>{diveLog.heading}</h2>
              <p className="mt-3 text-base">{diveLog.line}</p>
            </section>
          ) : null}
        </ShopSheet>
      </div>
    </div>
  );
}
