import { ExpiredLinkCard } from "@/components/ExpiredLinkCard";
import { FlashParams } from "@/components/FlashParams";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import type { Shop } from "@/db/schema";
import type { DiverMessageKey, DiverTranslator } from "@/i18n/messages";
import { noticeFromParam, noticeRole } from "@/lib/staff-notices";
import { emailFreshReadinessLinkAction } from "../booking-actions";

/**
 * **Which sentence a rescue attempt gets**, as a code the action carries in the
 * URL rather than a sentence it chose. `src/db` returns codes; the page picks
 * the words, so this reads in the visitor's own language and the action stays
 * free of copy — the same arrangement the waiver page's card uses.
 */
const RESCUE_NOTICES: Record<
  string,
  { tone: "success" | "danger" | "neutral"; key: DiverMessageKey }
> = {
  ok: { tone: "success", key: "ready.freshLinkSent" },
  // A newer link for this booking still works, so nothing was reissued — and
  // reissuing would have counted against the booking's live-capability cap.
  // Point them at their inbox without naming the address, like every other
  // notice on this card.
  live: { tone: "success", key: "ready.freshLinkCurrentLive" },
  none: { tone: "neutral", key: "ready.freshLinkNoEmail" },
  unavailable: { tone: "danger", key: "ready.freshLinkUnavailable" },
  failed: { tone: "danger", key: "ready.freshLinkFailed" },
  rate: { tone: "danger", key: "ready.rateLimited" },
};

const RESCUE_TONE: Record<"success" | "danger" | "neutral", string> = {
  success: "bg-success-tint text-success-strong",
  danger: "bg-danger-tint text-danger",
  neutral: "bg-surface-sunken text-muted",
};

/**
 * The dead-link card, with the one thing it can still do.
 *
 * #801 gave this card the shop's name and contact details; the button is the
 * other half of that issue, split out because it changes what the page can *do*
 * rather than what it says (issue #850). The rescue hands the caller nothing:
 * the fresh link goes to the address already on the booking, and only a code
 * comes back here.
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
  // `noticeFromParam`, not `RESCUE_NOTICES[sent]` — `sent` is attacker-supplied
  // and a bare lookup walks the prototype (src/lib/staff-notices.ts).
  const notice = noticeFromParam(sent, RESCUE_NOTICES);
  return (
    <ExpiredLinkCard
      title={t("ready.unavailableHeading")}
      text={t("ready.expiredBody")}
      shop={shop}
      t={t}
    >
      <FlashParams params={["sent"]} />
      {notice ? (
        <p
          role={noticeRole(notice.tone)}
          className={`rounded-lg px-4 py-3 font-medium ${RESCUE_TONE[notice.tone]}`}
        >
          {t(notice.key)}
        </p>
      ) : null}
      {/* `unavailable` is the one terminal answer — the booking is cancelled,
          or the token was never ours — so nothing about tapping again can
          change it. Offering the button would invite a pointless tap and spend
          the booking's rescue budget on it. Every other outcome is worth
          retrying: a provider failure passes, and a live link expires. */}
      {sent === "unavailable" ? null : (
        <form action={emailFreshReadinessLinkAction.bind(null, token)}>
          <SubmitButton pendingLabel={t("ready.sendingFreshLink")} className={buttonClass()}>
            {t("ready.emailFreshLink")}
          </SubmitButton>
        </form>
      )}
    </ExpiredLinkCard>
  );
}
