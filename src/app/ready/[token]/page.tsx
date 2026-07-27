import type { Metadata } from "next";
import { connection } from "next/server";
import { RentalFitForm } from "@/app/shop/[shopSlug]/schedule/[id]/_components/RentalFitForm";
import { EarnedMoment } from "@/components/EarnedMoment";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import {
  resolveRevokedBookingCapability,
  verifyBookingCapability,
} from "@/db/booking-capabilities";
import { getDb } from "@/db/client";
import { getBookingPayment } from "@/db/payments";
import { getReadyPageData, type ReadyPageData } from "@/db/ready";
import { telHref } from "@/lib/course-inquiry";
import { formatShortDate, formatTimeRangeTz } from "@/lib/format";
import {
  buildDiverChecklist,
  type ChecklistState,
  type DiverChecklistItem,
  nextDiverStep,
} from "@/lib/readiness-summary";
import {
  cancelMyBookingAction,
  payFromReady,
  rescheduleMyBookingAction,
  saveEmergencyContactFromReady,
  saveFitFromReady,
  signWaiverFromReady,
} from "./actions";

export const metadata: Metadata = {
  title: "Your trip readiness — DiveDay",
  robots: { index: false, follow: false },
};

const STATE_STYLE: Record<
  ChecklistState,
  { glyph: string; word: string; box: string; text: string }
> = {
  done: { glyph: "✓", word: "Done", box: "bg-success/10 text-success", text: "text-success" },
  action: {
    glyph: "→",
    word: "Your turn",
    box: "bg-primary/10 text-primary",
    text: "text-primary",
  },
  waiting: {
    glyph: "•",
    word: "With the shop",
    box: "bg-surface-sunken text-muted",
    text: "text-muted",
  },
};

function ChecklistRow({
  label,
  state,
  detail,
  action,
}: {
  label: string;
  state: ChecklistState;
  detail: string;
  action?: React.ReactNode;
}) {
  const style = STATE_STYLE[state];
  return (
    <li className="flex items-start gap-4 px-4 py-4 sm:px-5">
      <span
        aria-hidden="true"
        className={`grid size-10 shrink-0 place-items-center rounded-xl text-lg font-bold ${style.box}`}
      >
        {style.glyph}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <h3 className="text-base font-semibold">{label}</h3>
          <span className={`text-sm font-semibold ${style.text}`}>{style.word}</span>
        </div>
        <p className="mt-0.5 text-base text-muted">{detail}</p>
        {action ? <div className="mt-3">{action}</div> : null}
      </div>
    </li>
  );
}

function Notice({ title, text }: { title: string; text: string }) {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-16">
      <section className="rounded-2xl border border-border bg-surface p-7 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-3 text-muted">{text}</p>
      </section>
    </main>
  );
}

/** The action a checklist item enables on this page, if any. */
function itemAction(item: DiverChecklistItem, token: string, canPay: boolean): React.ReactNode {
  if (item.code === "waiver_pending") {
    return (
      <form action={signWaiverFromReady.bind(null, token)}>
        <SubmitButton pendingLabel="Opening…" className={buttonClass({ size: "sm" })}>
          Sign your waiver
        </SubmitButton>
      </form>
    );
  }
  if (item.code === "payment_due" && canPay) {
    return (
      <form action={payFromReady.bind(null, token)}>
        <SubmitButton pendingLabel="Opening payment…" className={buttonClass({ size: "sm" })}>
          Pay for this trip
        </SubmitButton>
      </form>
    );
  }
  return null;
}

const READY_NOTICES: Record<string, { tone: "success" | "danger" | "neutral"; text: string }> = {
  "saved-contact": { tone: "success", text: "Emergency contact saved — thank you." },
  "saved-contact-empty": {
    tone: "neutral",
    text: "We need both a name and a phone number so the crew can reach someone.",
  },
  "pay-paid": {
    tone: "success",
    text: "Payment received — we’re confirming it with your shop. Nothing more to do.",
  },
  "error-waiver": {
    tone: "danger",
    text: "We couldn’t open your waiver just now. Try again, or ask the shop for a link.",
  },
  "error-contact": {
    tone: "danger",
    text: "That name or phone number is too long — try a shorter version.",
  },
  "error-pay": {
    tone: "danger",
    text: "We couldn’t open the payment page. Your seat is safe — try again, or pay at the shop.",
  },
  "pay-cancelled": { tone: "neutral", text: "Payment cancelled — your seat is still held." },
  "error-cancel": {
    tone: "danger",
    text: "We couldn’t cancel this online — contact the shop directly.",
  },
  "saved-rescheduled": {
    tone: "success",
    text: "You’re moved! This is your new trip — the old one’s released.",
  },
  "error-reschedule": {
    tone: "danger",
    text: "That trip couldn’t hold you — maybe it just filled up. Try another, or contact the shop.",
  },
};

/**
 * What to tell the diver about their own refund, right after they cancel —
 * derived from the booking's own current payment status, not from anything
 * the client sent back. `?cancelled=1` on the URL is only a trigger to look;
 * it carries no claim of its own, so an edited or replayed query string
 * can't be used to assert a refund that didn't happen, or hide one that did
 * (Codex finding). This collapses several distinct non-refund outcomes
 * (past the free-cancellation window, no stated window, a failed/manual
 * Stripe reversal) into one honest "still paid, shop handles it" message,
 * since none of those specific reasons survive as durable state to verify
 * against — only whether the payment row currently reads `refunded` or
 * still `paid`/`deposit_paid` does.
 */
function verifiedCancelNotice(paymentStatus: string | null | undefined): string {
  if (paymentStatus === "refunded") {
    return "You paid for this trip, so a refund has been issued back to your card.";
  }
  if (paymentStatus === "paid" || paymentStatus === "deposit_paid") {
    return "You paid for this trip. This shop handles cancellation refunds directly — reach out to them about it.";
  }
  return "";
}

/** What cancelling right now would mean for money already paid — shown before the diver commits. */
const CANCEL_PREVIEW_TEXT: Record<ReadyPageData["cancelPreview"], string> = {
  refund: " You're still inside the free-cancellation window, so what you paid comes back to you.",
  forfeit: " You're past the free-cancellation window, so what you paid won't be refunded.",
  no_policy: "",
  unpaid: "",
};

/** The "This booking was cancelled" notice, with refund copy derived from the booking's current payment status. */
function cancelledNotice(
  paymentStatus: string | null | undefined,
  tripTitle: string,
  shopName: string,
) {
  const refundText = verifiedCancelNotice(paymentStatus);
  return (
    <Notice
      title="This booking was cancelled"
      text={
        refundText ||
        `Your seat on ${tripTitle} is no longer held. If that’s a surprise, get in touch with ${shopName}.`
      }
    />
  );
}

export default async function DiverReadinessPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ saved?: string; error?: string; pay?: string; cancelled?: string }>;
}) {
  await connection();
  const { token } = await params;
  const { saved, error, pay, cancelled } = await searchParams;
  const db = await getDb();
  const capability = await verifyBookingCapability(db, { token, purpose: "readiness" });
  if (!capability) {
    // A diver's own cancel action revokes this exact token as part of
    // cancelling, then redirects back to it with `?cancelled=1` — so the
    // normal verified-capability path above can never show the refund
    // notice for a self-cancel. Resolve the token with the revocation check
    // relaxed (never the cancelled-booking or shop-scoping checks) so that
    // one redirect still lands on an honest confirmation instead of the
    // generic "isn't available" notice. `cancelled` is only the trigger to
    // look — the refund copy itself comes from the booking's own current
    // payment row, fetched fresh here, never from the query string.
    if (cancelled) {
      const resolved = await resolveRevokedBookingCapability(db, { token, purpose: "readiness" });
      if (resolved) {
        const data = await getReadyPageData(db, resolved.bookingId);
        if (data?.detail.cancelled) {
          const payment = await getBookingPayment(db, data.shop.id, resolved.bookingId);
          return cancelledNotice(payment?.status, data.detail.trip.title, data.detail.shop.name);
        }
      }
    }
    return (
      <Notice
        title="This readiness link isn’t available"
        text="Ask your dive shop for a fresh link — nothing here is private to anyone but you."
      />
    );
  }
  const { bookingId } = capability;

  const data = await getReadyPageData(db, bookingId);
  if (!data) {
    return (
      <Notice
        title="This readiness link isn’t available"
        text="Ask your dive shop for a fresh link."
      />
    );
  }

  const { detail, shop, person } = data;
  const firstName = detail.person.fullName.split(" ")[0] || "there";
  const when = formatShortDate(detail.trip.startsAt, "en-US", detail.shop.timezone);
  const timeRange = formatTimeRangeTz(
    detail.trip.startsAt,
    detail.trip.endsAt,
    "en-US",
    detail.shop.timezone,
  );

  if (detail.cancelled) {
    return cancelledNotice(cancelled, detail.trip.title, detail.shop.name);
  }

  const items = buildDiverChecklist(detail.requirement, detail.readiness);
  const nextStep = nextDiverStep(items);
  const ready = detail.readiness.status === "ready";
  const hasEmergencyContact = Boolean(person.emergencyContactName && person.emergencyContactPhone);
  const noticeKey = saved ? `saved-${saved}` : error ? `error-${error}` : pay ? `pay-${pay}` : null;
  const notice = noticeKey ? READY_NOTICES[noticeKey] : undefined;

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-10 sm:py-16">
      <FlashParams params={["saved", "error", "pay"]} />
      <header>
        <p className="text-sm font-medium tracking-widest text-primary uppercase">
          {detail.shop.name}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-balance">
          {detail.trip.title}
        </h1>
        <p className="mt-1 text-base text-muted">
          {when} · {timeRange}
        </p>
      </header>

      {notice ? (
        <div className="mt-6">
          <ShopNotice tone={notice.tone} role={notice.tone === "danger" ? "alert" : "status"}>
            {notice.text}
          </ShopNotice>
        </div>
      ) : null}

      {ready ? (
        <EarnedMoment
          className="mt-8"
          eyebrow="You’re all set"
          title={`See you ${when}, ${firstName}! 🤿`}
        >
          <p>
            Everything’s in order for your trip. Your shop will confirm exact arrival details —
            we’ll see you at the dock.
          </p>
        </EarnedMoment>
      ) : (
        <section className="mt-8 rounded-2xl border border-border bg-surface p-5 sm:p-6">
          <h2 className="text-xl font-semibold text-balance">Almost there, {firstName}.</h2>
          <p className="mt-2 text-base text-muted">
            {nextStep
              ? `Next: ${nextStep.detail}`
              : "Your shop is finishing the last checks — there’s nothing you need to do right now."}
          </p>
        </section>
      )}

      <section className="mt-6" aria-labelledby="checklist-heading">
        <h2
          id="checklist-heading"
          className="text-sm font-bold tracking-[0.16em] text-muted uppercase"
        >
          Your pre-trip checklist
        </h2>
        <ul className="mt-3 divide-y divide-border rounded-2xl border border-border bg-surface">
          {items.map((item) => (
            <ChecklistRow
              key={item.category}
              label={item.label}
              state={item.state}
              detail={item.detail}
              action={itemAction(item, token, data.canPay)}
            />
          ))}
          <ChecklistRow
            label="Emergency contact"
            state={hasEmergencyContact ? "done" : "action"}
            detail={
              hasEmergencyContact
                ? `On file — ${person.emergencyContactName}. Update it below if it’s changed.`
                : "Someone we can reach for you on the day — a name and a phone the crew can call."
            }
            action={
              <form
                action={saveEmergencyContactFromReady.bind(null, token)}
                className="flex flex-col gap-3"
              >
                <FieldGrid columns={2}>
                  <Field label="Contact name">
                    <input
                      name="emergencyContactName"
                      autoComplete="name"
                      maxLength={120}
                      defaultValue={person.emergencyContactName ?? ""}
                      className={controlClass}
                    />
                  </Field>
                  <Field label="Contact phone">
                    <input
                      name="emergencyContactPhone"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      maxLength={40}
                      defaultValue={person.emergencyContactPhone ?? ""}
                      className={controlClass}
                    />
                  </Field>
                </FieldGrid>
                <div>
                  <SubmitButton
                    pendingLabel="Saving…"
                    className={buttonClass({ variant: "secondary", size: "sm" })}
                  >
                    {hasEmergencyContact ? "Update contact" : "Save contact"}
                  </SubmitButton>
                </div>
              </form>
            }
          />
        </ul>
      </section>

      <section className="mt-6" aria-labelledby="setup-heading">
        <h2 id="setup-heading" className="text-sm font-bold tracking-[0.16em] text-muted uppercase">
          Gear and setup
        </h2>
        <RentalFitForm
          action={saveFitFromReady.bind(null, token)}
          rentalFit={data.rentalFit}
          rentalItems={data.shop.rentalItems}
          pricing={data.shop.rentalPricing}
          wantsNitrox={data.wantsNitrox}
          nitroxCardVerified={data.nitroxCardVerified}
          plannedDives={data.trip.plannedDives}
          saved={saved === "fit"}
        />
      </section>

      <section
        className="mt-6 rounded-2xl border border-border bg-surface p-5 sm:p-6"
        aria-labelledby="change-plans-heading"
      >
        <h2
          id="change-plans-heading"
          className="text-sm font-bold tracking-[0.16em] text-muted uppercase"
        >
          Need to change your plans?
        </h2>

        {data.rescheduleCandidates && data.rescheduleCandidates.length > 0 ? (
          <div className="mt-3">
            <p className="text-base text-muted">
              Pick a different trip and we’ll move you — your current spot only releases once the
              new one’s confirmed, so you’re never left without one.
            </p>
            <form
              action={rescheduleMyBookingAction.bind(null, token)}
              className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center"
            >
              <label htmlFor="newTripId" className="sr-only">
                Pick a trip
              </label>
              <select id="newTripId" name="newTripId" required className={controlClass}>
                <option value="">Choose a trip…</option>
                {data.rescheduleCandidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.title} —{" "}
                    {formatShortDate(candidate.startsAt, "en-US", detail.shop.timezone)} ·{" "}
                    {formatTimeRangeTz(
                      candidate.startsAt,
                      candidate.endsAt,
                      "en-US",
                      detail.shop.timezone,
                    )}{" "}
                    · {candidate.spotsLeft} left
                  </option>
                ))}
              </select>
              <SubmitButton
                pendingLabel="Moving…"
                confirmMessage="Move your booking to this trip? Your current spot releases as soon as the new one holds."
                className={buttonClass({ variant: "secondary", size: "sm" })}
              >
                Move my booking
              </SubmitButton>
            </form>
          </div>
        ) : null}

        <div
          className={
            data.rescheduleCandidates?.length ? "mt-6 border-t border-border pt-5" : "mt-3"
          }
        >
          <p className="text-base text-muted">
            Cancelling frees your seat right away.
            {CANCEL_PREVIEW_TEXT[data.cancelPreview]}
          </p>
          <form action={cancelMyBookingAction.bind(null, token)} className="mt-3">
            <SubmitButton
              pendingLabel="Cancelling…"
              confirmMessage={`Cancel your spot on ${detail.trip.title}? This can’t be undone.`}
              className={buttonClass({ variant: "danger", size: "sm" })}
            >
              Cancel my spot
            </SubmitButton>
          </form>
        </div>
      </section>

      <p className="mt-8 text-center text-sm text-muted">
        Questions? Reach out to {detail.shop.name}
        {shop.contactPhone || shop.contactEmail ? " — " : ""}
        {shop.contactPhone ? (
          <a href={telHref(shop.contactPhone)} className="font-medium text-primary hover:underline">
            {shop.contactPhone}
          </a>
        ) : null}
        {shop.contactPhone && shop.contactEmail ? " · " : ""}
        {shop.contactEmail ? (
          <a
            href={`mailto:${shop.contactEmail}`}
            className="font-medium text-primary hover:underline"
          >
            {shop.contactEmail}
          </a>
        ) : null}
        . They can see exactly what’s on this page.
      </p>
    </main>
  );
}
