import type { Metadata } from "next";
import { connection } from "next/server";
import { RentalFitForm } from "@/app/shop/[shopSlug]/schedule/[id]/_components/RentalFitForm";
import { EarnedMoment } from "@/components/EarnedMoment";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { getDb } from "@/db/client";
import { getReadyPageData } from "@/db/ready";
import { telHref } from "@/lib/course-inquiry";
import { formatShortDate, formatTimeRangeTz } from "@/lib/format";
import { verifyReadinessToken } from "@/lib/readiness-links";
import {
  buildDiverChecklist,
  type ChecklistState,
  type DiverChecklistItem,
  nextDiverStep,
} from "@/lib/readiness-summary";
import {
  payFromReady,
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
  "error-pay": {
    tone: "danger",
    text: "We couldn’t open the payment page. Your seat is safe — try again, or pay at the shop.",
  },
  "error-nitrox-card": {
    tone: "neutral",
    text: "Your fit is saved, but enriched air needs a verified nitrox card on file. Bring it to the counter.",
  },
  "pay-cancelled": { tone: "neutral", text: "Payment cancelled — your seat is still held." },
};

export default async function DiverReadinessPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ saved?: string; error?: string; pay?: string }>;
}) {
  await connection();
  const { token } = await params;
  const { saved, error, pay } = await searchParams;
  const bookingId = verifyReadinessToken(token);
  if (!bookingId) {
    return (
      <Notice
        title="This readiness link isn’t available"
        text="Ask your dive shop for a fresh link — nothing here is private to anyone but you."
      />
    );
  }

  const db = await getDb();
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
    return (
      <Notice
        title="This booking was cancelled"
        text={`Your seat on ${detail.trip.title} is no longer held. If that’s a surprise, get in touch with ${detail.shop.name}.`}
      />
    );
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
          wantsNitrox={data.wantsNitrox}
          nitroxCardVerified={data.nitroxCardVerified}
          plannedDives={data.trip.plannedDives}
          saved={saved === "fit"}
        />
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
