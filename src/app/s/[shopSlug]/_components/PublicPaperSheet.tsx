import type { ReactNode } from "react";
import {
  DeparturePaperIdentity,
  formatPaperDateTime,
} from "@/app/shop/[shopSlug]/trips/[id]/_components/DeparturePaperIdentity";
import { PaperSheet, SheetMark } from "@/components/paper/PaperSheet";
import type { DiverTranslator } from "@/i18n/messages";
import { publicAppUrl } from "@/lib/notifications";
import { capabilityPagePrintRule, PACKET_PAPER, paperAddress } from "@/lib/print-sheets";
import { shopAddressLines } from "@/lib/shop-address";

/** What a diver page's sheet reads off the shop. */
export type PaperShop = {
  name: string;
  timezone: string;
  contactPhone: string | null;
  contactEmail: string | null;
  addressStreet: string | null;
  addressLocality: string | null;
  addressRegion: string | null;
  addressPostalCode: string | null;
  addressCountry: string | null;
};

/** A section of a sheet: a hairline above, never a panel. */
export function PaperRule({ children }: { children: ReactNode }) {
  return <div className="mt-5 border-t border-border pt-3">{children}</div>;
}

/**
 * **A diver page on paper** (issue #2745): the public trip, course and
 * schedule pages, framed or not, each print one sheet in the shop's paper and
 * never their screen. The sheet is drawn under the screen and shown only to
 * the printer (`data-paper-print-only`); on paper a page holding a sheet is
 * its sheets (`globals.css`), so the screen's controls, photos, forms and
 * chrome need no print variant of their own.
 *
 * It owns what each of those sheets says the same way: the shop in the band,
 * how to reach it as words (nothing on paper taps), when it was printed with
 * the year and the zone, and the page's own address in the fold. A page
 * opened by a bearer link prints with no margin, so the browser has nowhere to
 * write the link (`capabilityPagePrintRule`); every other page names itself in
 * the margin of every page it runs to (`DeparturePaperIdentity`).
 */
export function PublicPaperSheet({
  shop,
  pageName,
  identity,
  path,
  locale,
  t,
  now,
  bearer = false,
  children,
}: {
  shop: PaperShop;
  /** The named page (`departure-public-*`) whose margin carries `identity`. */
  pageName: string;
  identity: string[];
  /** The page's own public path, printed in the fold without a scheme. */
  path: string;
  locale: string;
  t: DiverTranslator;
  now: Date;
  /** The URL carries a booking, wait-list or handoff link. */
  bearer?: boolean;
  children: ReactNode;
}) {
  const zone = shop.timezone;
  const contact = [shop.contactPhone, shop.contactEmail].filter(Boolean).join(" · ");
  const address = shopAddressLines({
    street: shop.addressStreet,
    locality: shop.addressLocality,
    region: shop.addressRegion,
    postalCode: shop.addressPostalCode,
    country: shop.addressCountry,
  }).join(", ");
  const sheet = (
    <PaperSheet
      paper={PACKET_PAPER}
      band={
        <>
          <SheetMark name={shop.name} size="sm" />
          <span className="font-brand-display text-sm font-bold">{shop.name}</span>
        </>
      }
      // Paper outlives the week: the stamp carries the year and names its zone.
      foldLeft={t("ready.sheetAsOf", {
        when: `${formatPaperDateTime(now, locale, zone)} · ${zone}`,
      })}
      foldRight={paperAddress(path, publicAppUrl())}
    >
      {children}
      {contact || address ? (
        <PaperRule>
          {contact ? (
            <p className="text-sm">
              {t("trip.questionsContact")} {contact}
            </p>
          ) : null}
          {address ? <p className="text-sm">{address}</p> : null}
        </PaperRule>
      ) : null}
    </PaperSheet>
  );
  return (
    <div className="paper-sheet-frame" data-paper-print-only="">
      <div>
        {bearer ? (
          <>
            <style data-capability-print="">{capabilityPagePrintRule()}</style>
            {sheet}
          </>
        ) : (
          // The fold already says when; the margin says which page.
          <DeparturePaperIdentity pageName={pageName} identity={identity} printed="">
            {sheet}
          </DeparturePaperIdentity>
        )}
      </div>
    </div>
  );
}
