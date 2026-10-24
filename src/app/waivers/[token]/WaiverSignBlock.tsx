import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import type { DiverTranslator } from "@/i18n/messages";
import { saveWaiverDraftAction } from "./actions";

/**
 * `buttonClass` bakes in `text-sm`, and a plain `text-base` in `className` loses
 * the cascade because Tailwind emits `.text-sm` after `.text-base`. This waiver
 * is read at arm's length on a dock, so its actions keep their 16px label via
 * the token-valued utility, which does win.
 */
const labelTextBase = "text-(length:--text-base) leading-6";

/**
 * **One primary** (ADR 20260827-the-divers-thread, decision 5). Sign and
 * "Save and finish later" used to share a row as two buttons, which on a
 * phone stacked them at inverted weight — the bordered secondary above the
 * primary — so the page's one act was the second thing a thumb reached. Sign
 * is the full width of the card it belongs to, and saving demotes to a text
 * link on the line with the expiry sentence that explains why you'd want it.
 * It is still a real submit, so it still works with no JavaScript at all.
 *
 * Rendered once, in the **last** card: the diver's signature card for an
 * adult, the guardian's card for a minor (ADR 20260907-guardian-co-signature).
 * `expiresAt` arrives formatted in the reader's locale and the shop's zone.
 */
export function WaiverSignBlock({
  token,
  expiresAt,
  t,
}: {
  token: string;
  expiresAt: string;
  t: DiverTranslator;
}) {
  return (
    <>
      <SubmitButton
        pendingLabel={t("waiver.signing")}
        className={buttonClass({
          className: `mt-6 w-full disabled:opacity-70 ${labelTextBase}`,
        })}
      >
        {t("waiver.signButton")}
      </SubmitButton>
      {/* Two facts on one line from `sm`, split by the dot; stacked below it,
          with no dot. The row used to wrap, and the wrap fell after the dot:
          "Save and finish later ·" on one line at 390, the expiry alone on
          the next (K-340). It never wraps now — from `sm` a sentence too long
          for the line (the Spanish pair all but fills the 478px card)
          wraps inside its own span beside the link, which does not shrink.
          From `sm` the link ends the card, and the unseen half of its 44px
          box sank into the card's padding instead of adding to it: 38px under
          these words against 30px over the heading (K-493). The row lines its
          words up by their baseline, which the pulled-up margin cannot move;
          below `sm` the expiry sits under the link, so the box stays whole. */}
      <div className="mt-1 flex items-baseline gap-x-2 text-sm text-muted max-sm:flex-col max-sm:items-start">
        <button
          type="submit"
          formAction={saveWaiverDraftAction.bind(null, token)}
          // Drafts intentionally accept partial answers — the `required`
          // on signerName/acknowledged (and the pre-existing one on each
          // medical radio) would otherwise let the browser block a
          // legitimate "save what I have so far" submit.
          formNoValidate
          // `link`, flush: reads as inline text and still claims the
          // 44px target `base` bakes in — the wrapper's own answer to
          // "a control that is not the primary act".
          className={buttonClass({
            variant: "link",
            size: "sm",
            flush: true,
            outdent: "block-end-wide",
            className: "shrink-0",
          })}
        >
          {t("waiver.saveForLater")}
        </button>
        <span aria-hidden="true" className="max-sm:hidden">
          ·
        </span>
        <span>
          {t("waiver.linkExpiresAt", {
            date: expiresAt,
          })}
        </span>
      </div>
    </>
  );
}
