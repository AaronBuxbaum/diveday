import type { WaiverSendCopy } from "@/app/actions/waiver-send-types";
import {
  WaitlistInvite,
  type WaitlistInviteCopy,
} from "@/app/shop/[shopSlug]/trips/[id]/_components/WaitlistInvite";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { LedgerRow } from "@/components/ui/ledger";
import { StatusMark } from "@/components/ui/StatusMark";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { ACTION_KIND_KEYS } from "@/i18n/today-labels";
import { ACTION_KIND_META, type TodayAction } from "@/lib/today";
import { PaymentActionControl, type PaymentActionCopy } from "./PaymentActionControl";
import {
  ResendConfirmationControl,
  type ResendConfirmationCopy,
} from "./ResendConfirmationControl";
import { WaiverSendControl } from "./WaiverSendControl";

export type SpineHelpRequestAction = (
  requestId: string,
  status: "acknowledged" | "handled",
) => Promise<void>;

/**
 * **One job, drawn once.** These rows were private to `DaySpine`, which was
 * right while the day was the only surface that ranked work. The departure
 * page ranks the same work for one boat (ADR 20260919-one-idea, slice 23c:
 * "below, what is due before lines off"), and a second drawing of a
 * `TodayAction` is how the two would come to disagree about what a blocked
 * diver looks like — on the day's page and on the page a crew actually stands
 * on before lines off.
 *
 * Nothing here changed in the move except the two `export` keywords.
 */

export type RowControls = {
  shopSlug: string;
  shopName: string;
  waiverCopy: WaiverSendCopy;
  resendCopy: ResendConfirmationCopy;
  inviteCopy: WaitlistInviteCopy;
  paymentCopy: PaymentActionCopy;
  helpRequestAction?: SpineHelpRequestAction;
  t: StaffTranslator;
};

/**
 * One job, as a ledger row: its kind as a word in the row's own type, the one
 * sentence saying what is wrong, and the one fix beside it.
 *
 * A row whose fix *performs* something — a waiver send, a wait-list invite, an
 * invoice resend — keeps a real control, because the tap has a consequence. A
 * row whose fix merely navigates becomes the link itself, with the destination
 * named for a screen reader on the stretched overlay and a quiet chevron for
 * everyone else (principle 10, "actions ride on their objects").
 */
/**
 * **The key a performing row keeps across its own fix landing.**
 *
 * `TodayAction.id` is `blocker:<booking>:<code>`, and the code is exactly what
 * a fix changes — a waiver goes from `waiver_missing` to `waiver_pending` the
 * moment it is sent. Keyed on the id, the row that was just tapped is a
 * *different* row to React, so its control unmounts and takes `useActionState`
 * with it: on a shop with no email configured that discards the private
 * fallback link the tap just produced, which is the one thing the staffer
 * needed. The row's own words still update — that part was never in doubt —
 * but the payload disappeared between the tap and the render.
 *
 * So a row that *performs* is keyed on what it performs against, which does
 * not change when the fix lands. A row that merely navigates holds no state
 * and keeps the id.
 */
export function rowKey(action: TodayAction): string {
  if (action.waiver) return `waiver:${action.waiver.bookingIds.join(",")}`;
  if (action.resend) return `resend:${action.resend.bookingId}`;
  if (action.invite) return `invite:${action.invite.entryId}`;
  if (action.payment?.orderId) return `payment:${action.payment.orderId}`;
  if (action.helpRequest) return `help-request:${action.helpRequest.requestId}`;
  return action.id;
}

/**
 * A horizon's panel: the tideline, the panel radius, no bed (a sunken panel
 * sits *in* the sand rather than on it), and the same inset padding on the
 * summary row and the week row so the two doors align. From `sm` up only —
 * on a phone the two horizons keep the row grammar they always had, one under
 * the other, because a panel's own padding was what pushed "Tomorrow · Wed,
 * Jul 22" onto two lines at 390px.
 */

/** The status family's shape for each kind tone, and the ink it takes. */
const ROW_GLYPH = { danger: "danger", warning: "warning", neutral: "pending" } as const;
const ROW_GLYPH_INK = {
  danger: "text-danger",
  warning: "text-warning-strong",
  neutral: "text-muted",
} as const;

export function StationRow({ action, controls }: { action: TodayAction; controls: RowControls }) {
  const { t } = controls;
  const performs = Boolean(
    action.waiver ||
      action.resend ||
      action.invite ||
      action.payment?.orderId ||
      action.helpRequest,
  );
  // One line per row (ADR 20260904-reef-all-the-way-down, slice 16a): the
  // person, then the sentence, at reading size — a subject over a detail at
  // 14px was the rail's grammar, and a panel reads as one sentence with a name
  // in it. Each half keeps its own element so a reader (and a test) can find
  // either by its own words.
  const tone = ACTION_KIND_META[action.kind].tone;
  // A row whose subject already is the whole fact carries no detail at all
  // (the desk's two counting rows), so neither the separator nor the second
  // span renders — a dangling " · " is the shape of a sentence that was
  // deleted rather than one that never existed.
  const body = (
    <p className="min-w-0 py-2 text-base leading-snug">
      {action.aboutDeparture ? null : (
        <>
          <span className="font-medium">{action.subject}</span>
          {action.detail ? (
            <span aria-hidden="true" className="text-muted">
              {" · "}
            </span>
          ) : null}
        </>
      )}
      {action.detail ? (
        <span className={tone === "neutral" ? "text-muted" : undefined}>{action.detail}</span>
      ) : null}
    </p>
  );
  const control = action.waiver ? (
    <WaiverSendControl
      surface="today"
      bookingIds={action.waiver.bookingIds}
      label={action.actionLabel}
      copy={controls.waiverCopy}
    />
  ) : action.resend ? (
    <ResendConfirmationControl
      shopSlug={controls.shopSlug}
      bookingId={action.resend.bookingId}
      label={action.actionLabel}
      copy={controls.resendCopy}
    />
  ) : action.invite ? (
    <WaitlistInvite
      entryId={action.invite.entryId}
      personName={action.invite.personName}
      personEmail={action.invite.personEmail}
      invitedAt={action.invite.invitedAt}
      bookingPath={action.invite.bookingPath}
      shopName={controls.shopName}
      tripTitle={action.invite.tripTitle}
      tripWhen={action.invite.tripWhen}
      tripId={action.invite.tripId}
      copy={controls.inviteCopy}
    />
  ) : action.payment?.orderId ? (
    <PaymentActionControl
      shopSlug={controls.shopSlug}
      orderId={action.payment.orderId}
      hostedInvoiceUrl={action.payment.hostedInvoiceUrl ?? null}
      copy={controls.paymentCopy}
    />
  ) : action.helpRequest && controls.helpRequestAction ? (
    <form
      action={controls.helpRequestAction.bind(
        null,
        action.helpRequest.requestId,
        action.helpRequest.status === "requested" ? "acknowledged" : "handled",
      )}
      className="flex sm:inline-flex"
    >
      <SubmitButton
        pendingLabel={t("today.helpRequest.saving")}
        className={buttonClass({ variant: "secondary", size: "sm", className: "shrink-0" })}
      >
        {action.actionLabel}
      </SubmitButton>
    </form>
  ) : // **Nothing at all: the row's own tap is its only door** (ADR
  // 20260911-clear-the-deck, the floor's first row). This branch used to
  // render the destination as a word — "Open crew", "Open prep list", "Open
  // guests" — beside a chevron `LedgerRow` was already drawing, which put
  // nine verbs on one screen for nine taps the row itself already answers.
  // The word survives only where it *is* the fix: a waiver send, a wait-list
  // invite, an invoice resend, a help-request hand-off. The name of the
  // destination is still spoken — it is the stretched overlay's `linkLabel`
  // below — so nothing was traded away from a reader who cannot see the
  // chevron.
  null;

  // One object, not two props. `LedgerRow`'s door is a union — a row carries
  // both `href` and a `linkLabel` or neither, so a link can never reach a
  // reader without an accessible name. Two independent ternaries cannot prove
  // that correlation to the compiler, and a row that performs its own fix
  // inline is deliberately not a door: the tap is the control beside it.
  const door = performs || !action.href ? {} : { href: action.href, linkLabel: action.actionLabel };

  return (
    <LedgerRow
      // Stacked below `sm`: the kind and the fix share the first line and the
      // sentence takes the width beneath them, which is the phone artboard's
      // reading and the only one where a full sentence has room to be read.
      stacked
      className="-mx-2 px-2"
      // The row's glyph — the first of the anatomy's four parts (glyph, one
      // word of kind, one sentence, one fix), drawn from the shipped status
      // family and never from the illustration hand: a status glyph is a
      // status, and the ADR keeps drawings out of that job. The kind word
      // beside it carries the meaning; the glyph is what a scan reads first.
      leading={<StatusMark variant={ROW_GLYPH[tone]} size="md" className={ROW_GLYPH_INK[tone]} />}
      kind={{
        word: t(ACTION_KIND_KEYS[action.kind]),
        tone,
      }}
      trailing={control}
      {...door}
    >
      {body}
    </LedgerRow>
  );
}

export function StationRows({
  rows,
  controls,
}: {
  rows: readonly TodayAction[];
  controls: RowControls;
}) {
  if (rows.length === 0) return null;
  return (
    <ul className="mt-4">
      {rows.map((action) => (
        <StationRow key={rowKey(action)} action={action} controls={controls} />
      ))}
    </ul>
  );
}
