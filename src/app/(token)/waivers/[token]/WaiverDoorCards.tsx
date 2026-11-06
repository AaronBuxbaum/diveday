import { DeadLink } from "@/components/DeadLink";
import { ExpiredLinkCard } from "@/components/ExpiredLinkCard";
import { FlashParams } from "@/components/FlashParams";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { ShopNotice } from "@/components/ui/outcome";
import { noticeRole } from "@/components/ui/tone";
import type { Shop } from "@/db/schema";
import type { DiverMessageKey, DiverTranslator } from "@/i18n/messages";
import { noticeFromParam } from "@/lib/staff-notices";
import { claimCounterLinkAction, emailFreshWaiverLinkAction } from "./actions";

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
    <DeadLink t={t} next={t("waiver.expiredBody")} shop={shop}>
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
          <SubmitButton pendingLabel={t("words.busy.sending")} className={buttonClass()}>
            {t("waiver.emailFreshLink")}
          </SubmitButton>
        </form>
      )}
    </DeadLink>
  );
}

/**
 * The card for a waiver link that resolves no record at all, so names no shop
 * and offers DiveDay's own door (`ExpiredLinkCard`'s shopless branch) rather
 * than ending on a sentence with nothing to tap (UX review 2026-10-10, item 11).
 */
export function UnavailableWaiverLink({ t }: { t: DiverTranslator }) {
  return <DeadLink t={t} />;
}

/**
 * **A counter QR not yet opened on any phone** (attacker review S1). The code
 * opens on one phone only, so the diver says "this one" with a tap; the next
 * phone to scan it is turned away (`CounterElsewhereCard`).
 */
export function CounterClaimCard({ token, t }: { token: string; t: DiverTranslator }) {
  return (
    <ExpiredLinkCard
      wordmark
      glyph="sent"
      title={t("waiver.counterClaimTitle")}
      text={t("waiver.counterClaimBody")}
    >
      <form action={claimCounterLinkAction.bind(null, token)}>
        <SubmitButton pendingLabel={t("words.busy.opening")} className={buttonClass()}>
          {t("waiver.counterClaimButton")}
        </SubmitButton>
      </form>
    </ExpiredLinkCard>
  );
}

/** A counter QR already open on another phone: it opens nothing here. */
export function CounterElsewhereCard({ t }: { t: DiverTranslator }) {
  return (
    <ExpiredLinkCard
      wordmark
      title={t("waiver.counterElsewhereTitle")}
      text={t("waiver.counterElsewhereBody")}
    />
  );
}
