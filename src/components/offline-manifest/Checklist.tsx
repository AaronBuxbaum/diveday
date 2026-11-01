import { sectionCardClass } from "@/components/ui/card";
import { StatusMark } from "@/components/ui/StatusMark";
import { useClearConfirmation } from "@/components/useClearConfirmation";
import { latestOfflineChecklistCheck } from "@/lib/offline-manifests";
import type { PreDepartureCheckStatus } from "@/lib/pre-departure-check";
import type { OfflineTripControls } from "./controls";
import type { OfflineTripView } from "./trip-view";

/**
 * The boat's open snags as saved (fifth-loop ideas, item 1), read-only: an
 * answer is a write the server must check, so it waits for the dock. Renders
 * nothing for a copy that carries none.
 */
export function OfflineSnags({ view }: { view: OfflineTripView }) {
  const snags = view.envelope.snapshot.snags;
  if (!snags || snags.items.length === 0) return null;
  return (
    <section
      // The live check's warning tint (`CarriedSnags`), so the two copies look alike.
      className="mt-6 rounded-panel border border-border bg-warning/10 p-4"
      aria-labelledby="boat-snags-heading"
    >
      <h2 id="boat-snags-heading" className="text-base font-semibold text-ink">
        {snags.heading}
      </h2>
      <ul className="mt-3 flex flex-col gap-3">
        {snags.items.map((snag) => (
          <li key={`${snag.line}|${snag.notedBy}`} className="text-sm">
            <p className="font-medium text-ink">{snag.line}</p>
            <p className="text-muted">{snag.notedBy}</p>
            {snag.stillThere ? <p className="text-muted">{snag.stillThere}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The pre-departure checklist as saved, checkable with no signal. Renders
 * nothing for a shop with no checklist items.
 */
export function OfflineChecklist({
  view,
  controls,
}: {
  view: OfflineTripView;
  controls: OfflineTripControls;
}) {
  const { envelope, expired } = view;
  const { t, busyChecklistItem, recordChecklistCheck } = controls;
  return envelope.snapshot.checklist && envelope.snapshot.checklist.items.length > 0 ? (
    <section
      className={sectionCardClass({ padding: "none", className: "mt-6" })}
      aria-labelledby="pre-departure-check-heading"
    >
      <h2 id="pre-departure-check-heading" className="px-4 py-4 text-base font-semibold text-ink">
        {t("shared.offlineManifest.single.checklist.heading")}
      </h2>
      {/* Flat rows under one divider, the live check's shape (B07). */}
      <ul className="divide-y divide-border border-t border-border">
        {envelope.snapshot.checklist.items.map((item) => {
          const check = latestOfflineChecklistCheck(
            envelope.snapshot,
            item.id,
            envelope.checklistEvents,
          );
          return (
            <OfflineChecklistRow
              key={item.id}
              label={item.label}
              checked={check !== undefined}
              busy={busyChecklistItem === item.id}
              expired={expired}
              t={t}
              onRecord={(status) => recordChecklistCheck(item.id, status)}
            />
          );
        })}
      </ul>
    </section>
  ) : null;
}

/**
 * One item. **Checking is one tap; clearing is two** (#2567), as on the live
 * checklist since #2481: a wet hand brushing the phone on a moving deck must
 * not quietly undo "Emergency oxygen kit aboard", so the first tap on a
 * checked item only asks. A blur, Escape, or a few seconds untouched stand it
 * down, and a bounced double tap (two taps ~50ms apart) is one tap: the ask
 * only arms, and only says "Tap again to clear", once the gap has passed.
 */
function OfflineChecklistRow({
  label,
  checked,
  busy,
  expired,
  t,
  onRecord,
}: {
  label: string;
  checked: boolean;
  busy: boolean;
  expired: boolean;
  t: OfflineTripControls["t"];
  onRecord: (status: PreDepartureCheckStatus) => void;
}) {
  const { armed, standDown, requestClear, onKeyDown } = useClearConfirmation({
    checked,
    pending: busy,
  });
  const confirmClear = t("shared.offlineManifest.single.checklist.confirmClear");
  return (
    <li>
      <button
        type="button"
        disabled={busy || expired}
        aria-busy={busy}
        aria-pressed={checked}
        onClick={(event) => {
          if (!checked) {
            onRecord("checked");
            return;
          }
          if (requestClear(event)) {
            standDown();
            onRecord("cleared");
          }
        }}
        onBlur={standDown}
        onKeyDown={onKeyDown}
        // A flat row (visual review 2026-10-24, B07). `gap-3`, the counter
        // row's below: the same mark and label, so the words start on one x
        // in both lists.
        className="flex min-h-14 w-full touch-manipulation items-start gap-3 px-4 py-3 text-start text-base font-semibold hover:bg-surface-sunken disabled:opacity-60"
      >
        <StatusMark variant={checked ? "checked" : "unchecked"} size="md" />
        <span className="flex min-w-0 flex-col">
          <span>{label}</span>
          {armed ? (
            <span className="text-sm font-semibold">{confirmClear}</span>
          ) : (
            <span className="sr-only">
              {checked
                ? t("shared.offlineManifest.single.checklist.checkedLabel")
                : t("shared.offlineManifest.single.checklist.uncheckedLabel")}
            </span>
          )}
        </span>
      </button>
      {/* A changed button name is not announced; this is. */}
      <span role="status" className="sr-only">
        {armed ? confirmClear : ""}
      </span>
    </li>
  );
}
