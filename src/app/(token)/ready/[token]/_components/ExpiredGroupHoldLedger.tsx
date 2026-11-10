import Link from "next/link";
import { ThreadShell } from "@/components/thread/ThreadShell";
import { resolveExpiredGroupHoldOrganizer } from "@/db/booking-capabilities";
import type { AppDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import { issuePartySeatClaims } from "@/features/seat-claims";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { publicSchedulePath } from "@/lib/public-routes";
import { PartyClaimPanel } from "./PartyClaimPanel";
import { partyClaimSeats } from "./PartySection";

/** An expired organizer can still answer who paid, but cannot act for any seat. */
export async function expiredGroupHoldLedger(db: AppDb, token: string) {
  const organizer = await resolveExpiredGroupHoldOrganizer(db, { token });
  if (!organizer) return null;
  const shop = await getShopById(db, organizer.shopId);
  if (!shop) return null;
  const claims = await issuePartySeatClaims(db, {
    shopId: organizer.shopId,
    leadBookingId: organizer.bookingId,
    issueClaims: false,
  });
  if (!claims.length) return null;
  const locale = await requestLocale(shop.defaultLocale);
  const t = diverTranslator(locale);
  const seats = partyClaimSeats(claims).map((seat) => ({
    ...seat,
    claimUrl: null,
    payable: false,
    signForMinor: false,
    minorNote: null,
  }));
  return (
    <ThreadShell shopName={shop.name} title={t("seatClaim.expiredOrganizerHeading")}>
      <div className="space-y-6">
        <p className="text-base text-muted">{t("seatClaim.expiredOrganizerBody")}</p>
        <PartyClaimPanel
          readOnly
          locale={locale}
          timeZone={shop.timezone}
          seats={seats}
          organizerSettled={false}
        />
        <Link
          href={publicSchedulePath(shop.slug)}
          className="inline-flex min-h-11 items-center font-medium text-primary hover:underline"
        >
          {t("ready.cancelledSeeSchedule")}
        </Link>
      </div>
    </ThreadShell>
  );
}
