import type { ReactNode } from "react";
import { ExpiredLinkCard } from "@/components/ExpiredLinkCard";
import type { Shop } from "@/db/schema";
import type { DiverTranslator } from "@/i18n/messages";

/**
 * **The one dead-link page** (visual review 2026-10-24, B29).
 *
 * Nine bearer-token pages (`/ready`, `/waivers`, `/recap`, `/claim`,
 * `/invite`, `/unsubscribe`, `/verify`, `/reset-password`,
 * `/confirm-contact`) had grown four headings for one situation, and only
 * three wore DiveDay's wordmark. Every one now says the same heading under
 * the same mark, then one next-step line: the page's own where it has one,
 * else "Ask the shop for a fresh link."
 *
 * It renders nothing from the token. The two tiers of the dead-link law
 * (ADR 20260827-first-light, decision 3) hold through `shop`: a booking token
 * that still resolves its shop passes it, and the card names that shop and its
 * published contact; an account token never does, so the card names nobody.
 * `diveDayDoor` is the shopless booking card's way off the page; the account
 * pages keep the screen they had, with no door.
 */
export function DeadLink({
  t,
  next,
  shop,
  diveDayDoor = true,
  children,
}: {
  t: DiverTranslator;
  /** The page's own next step; defaults to asking the shop for a fresh link. */
  next?: string;
  shop?: Pick<Shop, "name" | "contactEmail" | "contactPhone">;
  diveDayDoor?: boolean;
  /** What the card can still do, such as emailing a fresh link. */
  children?: ReactNode;
}) {
  return (
    <ExpiredLinkCard
      wordmark
      title={t("common.deadLinkHeading")}
      text={next ?? t("common.deadLinkNext")}
      shop={shop}
      t={shop || diveDayDoor ? t : undefined}
    >
      {children}
    </ExpiredLinkCard>
  );
}
