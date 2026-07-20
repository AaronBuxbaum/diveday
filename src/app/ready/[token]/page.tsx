import type { Metadata } from "next";
import { connection } from "next/server";
import { EarnedMoment } from "@/components/EarnedMoment";
import { getDb } from "@/db/client";
import { getBookingReadinessDetail } from "@/db/readiness";
import { formatShortDate, formatTimeRangeTz } from "@/lib/format";
import { verifyReadinessToken } from "@/lib/readiness-links";
import {
  buildDiverChecklist,
  type ChecklistState,
  type DiverChecklistItem,
  nextDiverStep,
} from "@/lib/readiness-summary";

export const metadata: Metadata = {
  title: "Your trip readiness — Scuba",
  robots: { index: false, follow: false },
};

const STATE_STYLE: Record<
  ChecklistState,
  { glyph: string; word: string; box: string; text: string }
> = {
  done: {
    glyph: "✓",
    word: "Done",
    box: "bg-success/10 text-success",
    text: "text-success",
  },
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

function ChecklistRow({ item }: { item: DiverChecklistItem }) {
  const style = STATE_STYLE[item.state];
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
          <h3 className="text-base font-semibold">{item.label}</h3>
          <span className={`text-sm font-semibold ${style.text}`}>{style.word}</span>
        </div>
        <p className="mt-0.5 text-base text-muted">{item.detail}</p>
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

export default async function DiverReadinessPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  await connection();
  const { token } = await params;
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
  const detail = await getBookingReadinessDetail(db, bookingId);
  if (!detail) {
    return (
      <Notice
        title="This readiness link isn’t available"
        text="Ask your dive shop for a fresh link."
      />
    );
  }

  const { shop, trip, person, requirement, readiness, cancelled } = detail;
  const firstName = person.fullName.split(" ")[0] || "there";
  const when = formatShortDate(trip.startsAt, "en-US", shop.timezone);
  const timeRange = formatTimeRangeTz(trip.startsAt, trip.endsAt, "en-US", shop.timezone);

  if (cancelled) {
    return (
      <Notice
        title="This booking was cancelled"
        text={`Your seat on ${trip.title} is no longer held. If that’s a surprise, get in touch with ${shop.name}.`}
      />
    );
  }

  const items = buildDiverChecklist(requirement, readiness);
  const nextStep = nextDiverStep(items);
  const ready = readiness.status === "ready";

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-10 sm:py-16">
      <header>
        <p className="text-sm font-medium tracking-widest text-primary uppercase">{shop.name}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-balance">{trip.title}</h1>
        <p className="mt-1 text-base text-muted">
          {when} · {timeRange}
        </p>
      </header>

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
            <ChecklistRow key={item.category} item={item} />
          ))}
        </ul>
      </section>

      <p className="mt-8 text-center text-sm text-muted">
        Questions? Reach out to {shop.name} — they can see exactly what’s on this page.
      </p>
    </main>
  );
}
