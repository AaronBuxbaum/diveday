import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { ACTION_KIND_META, groupActions, type TodayAction } from "@/lib/today";
import { WaiverSendControl } from "./WaiverSendControl";

const CHIP_TONES = {
  danger: "border-danger/30 bg-danger/10 text-danger",
  warning: "border-warning/30 bg-warning/10 text-warning",
  neutral: "border-border bg-surface-sunken text-muted",
} as const;

function KindChip({ kind }: { kind: TodayAction["kind"] }) {
  const { label, tone } = ACTION_KIND_META[kind];
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-bold tracking-wide uppercase ${CHIP_TONES[tone]}`}
    >
      {label}
    </span>
  );
}

function ActionRow({ action, shopSlug }: { action: TodayAction; shopSlug: string }) {
  return (
    <li className="rounded-2xl border border-border bg-surface p-4 shadow-sm transition-colors duration-200 hover:border-primary/40 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <KindChip kind={action.kind} />
            <p className="font-semibold">{action.subject}</p>
            {action.context ? <p className="text-sm text-muted">{action.context}</p> : null}
          </div>
          <p className="mt-1.5 text-muted">{action.detail}</p>
        </div>
        {action.waiver ? (
          <WaiverSendControl
            shopSlug={shopSlug}
            surface="today"
            bookingIds={action.waiver.bookingIds}
            label={action.actionLabel}
          />
        ) : (
          <Link
            href={action.href}
            className={buttonClass({ variant: "secondary", className: "shrink-0" })}
          >
            {action.actionLabel}
          </Link>
        )}
      </div>
    </li>
  );
}

/**
 * The queue. Grouped by how soon the work has to land, chronological inside
 * each group, one row per person or per boat — never one row per blocker, or a
 * single diver with three problems would bury everyone else.
 */
export function TodayQueue({
  actions,
  shopSlug,
}: {
  actions: readonly TodayAction[];
  shopSlug: string;
}) {
  const groups = groupActions(actions);

  if (groups.length === 0) {
    return (
      <section
        aria-labelledby="queue-heading"
        className="rounded-3xl border border-accent/30 bg-accent/5 p-8 text-center sm:p-10"
      >
        <div
          className="mx-auto grid size-12 place-items-center rounded-2xl bg-accent/15 text-2xl"
          aria-hidden="true"
        >
          🤙
        </div>
        <h2 id="queue-heading" className="mt-4 text-lg font-semibold">
          Nothing is waiting on you
        </h2>
        <p className="mx-auto mt-1 max-w-md text-muted">
          Every diver booked in the next week has their waiver, cards, and payment in order. Enjoy
          the surface interval.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="queue-heading">
      <h2 id="queue-heading" className="text-lg font-semibold">
        Needs you
      </h2>
      <p className="mt-1 text-sm text-muted">
        Sorted by the boat each one holds up. Clearing a row takes you straight to the fix.
      </p>
      <div className="mt-5 flex flex-col gap-8">
        {groups.map((group) => (
          <div key={group.urgency}>
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-xs font-bold tracking-[0.18em] text-muted uppercase">
                {group.label}
              </h3>
              <span className="text-xs font-semibold text-muted tabular-nums">
                {group.actions.length}
              </span>
            </div>
            <ul className="mt-3 flex flex-col gap-3">
              {group.actions.map((action) => (
                <ActionRow key={action.id} action={action} shopSlug={shopSlug} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
