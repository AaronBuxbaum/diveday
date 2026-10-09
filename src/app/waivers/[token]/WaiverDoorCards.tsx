import { ExpiredLinkCard } from "@/components/ExpiredLinkCard";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import type { Shop } from "@/db/schema";
import type { DiverMessageKey, DiverTranslator } from "@/i18n/messages";
import { noticeFromParam, noticeRole } from "@/lib/staff-notices";
import { emailFreshWaiverLinkAction } from "./actions";

/**
 * What the rescue send actually did, as one-word codes on the URL — the
 * action never puts a sentence (or an address, or a token) in the query
 * string, so this page picks the words in the reader's own language, the same
 * pattern `/ready`'s notices use.
 */
const RESCUE_NOTICES: Record<
  string,
  { tone: "success" | "danger" | "neutral"; key: DiverMessageKey }
> = {
  ok: { tone: "success", key: "waiver.freshLinkSent" },
  signed: { tone: "success", key: "waiver.freshLinkAlreadySigned" },
  // A newer link for this booking is still signable, so nothing was reissued —
  // reissuing would have killed it and taken the diver's saved answers with it.
  // Point them at their inbox without naming the address, same as every other
  // notice on this card.
  live: { tone: "success", key: "waiver.freshLinkCurrentLive" },
  none: { tone: "neutral", key: "waiver.freshLinkNoEmail" },
  unavailable: { tone: "danger", key: "waiver.freshLinkUnavailable" },
  failed: { tone: "danger", key: "waiver.freshLinkFailed" },
  rate: { tone: "danger", key: "waiver.rateLimited" },
};

/**
 * A waiver link that can no longer be signed, with the way out on it. The
 * diver mails themselves a fresh link instead of chasing the shop for one —
 * and because a waiver URL *is* its capability, the replacement is only ever
 * sent to the address already on the booking. The address is never shown or
 * confirmed back here (anyone holding the stale URL is reading this page, so
 * even a masked "n…@…" would be a disclosure), and the new token never
 * reaches this page at all. The shop's own contact details stay underneath as
 * the fallback for the outcomes mail can't fix.
 */
export function ExpiredLink({
  token,
  shop,
  t,
  sent,
}: {
  token: string;
  shop: Pick<Shop, "name" | "contactEmail" | "contactPhone">;
  t: DiverTranslator;
  sent?: string;
}) {
  // `Object.hasOwn`, not `RESCUE_NOTICES[sent]` — `sent` is attacker-supplied
  // and a bare lookup walks the prototype (src/lib/staff-notices.ts).
  const notice = noticeFromParam(sent, RESCUE_NOTICES);
  return (
    <ExpiredLinkCard
      title={t("waiver.expiredHeading")}
      text={t("waiver.expiredBody")}
      shop={shop}
      t={t}
    >
      <FlashParams params={["sent"]} />
      {/* The fourth of the four banner treatments this page had grown, and the
          last one to converge (ADR 20260827-the-divers-thread, decision 5): the
          rescue outcome speaks the same notice grammar as the refusal, the
          saved draft and the English-only note, rather than a private tone map
          of its own. */}
      {notice ? (
        <ShopNotice tone={notice.tone} role={noticeRole(notice.tone)}>
          {t(notice.key)}
        </ShopNotice>
      ) : null}
      {/* A signature already on file is the one outcome with nothing left to
          send — offering the button again would only invite a pointless email. */}
      {sent === "signed" ? null : (
        <form action={emailFreshWaiverLinkAction.bind(null, token)}>
          <SubmitButton pendingLabel={t("waiver.sendingFreshLink")} className={buttonClass()}>
            {t("waiver.emailFreshLink")}
          </SubmitButton>
        </form>
      )}
    </ExpiredLinkCard>
  );
}

/**
 * **A held seat's release link names nobody** (issue #2125). Whoever holds
 * the link may not be the person the seat was matched to, so the page renders
 * no form and asks nothing until the desk confirms who it is: no signer hint
 * (the matched person's full name) and no guardian section (which would say
 * whether that person is a minor). Only the shop's own contact is shown.
 */
export function HeldWaiverCard({
  shop,
  t,
}: {
  shop: Pick<Shop, "name" | "contactEmail" | "contactPhone">;
  t: DiverTranslator;
}) {
  return (
    <ExpiredLinkCard
      title={t("waiver.heldHeading")}
      text={t("waiver.heldBody")}
      shop={shop}
      t={t}
    />
  );
}
