import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { StatusMark } from "@/components/ui/StatusMark";
import { latestOfflineChecklistCheck } from "@/lib/offline-manifests";
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
      className={sectionCardClass({ className: "mt-6" })}
      aria-labelledby="pre-departure-check-heading"
    >
      <h2 id="pre-departure-check-heading" className="text-base font-semibold text-ink">
        {t("shared.offlineManifest.single.checklist.heading")}
      </h2>
      <ul className="mt-3 flex flex-col gap-2">
        {envelope.snapshot.checklist.items.map((item) => {
          const check = latestOfflineChecklistCheck(
            envelope.snapshot,
            item.id,
            envelope.checklistEvents,
          );
          const checked = check !== undefined;
          const busy = busyChecklistItem === item.id;
          return (
            <li key={item.id}>
              <button
                type="button"
                disabled={busy || expired}
                aria-busy={busy}
                aria-pressed={checked}
                onClick={() => recordChecklistCheck(item.id, checked ? "cleared" : "checked")}
                className={buttonClass({
                  variant: checked ? "primary" : "secondary",
                  size: "boat",
                  // `gap-3`, the counter row's below: the same mark and
                  // label, so the words start on one x in both lists.
                  className: "w-full justify-start gap-3 text-start",
                })}
              >
                <StatusMark variant={checked ? "checked" : "unchecked"} size="md" />
                <span className="flex min-w-0 flex-col">
                  <span>{item.label}</span>
                  <span className="sr-only">
                    {checked
                      ? t("shared.offlineManifest.single.checklist.checkedLabel")
                      : t("shared.offlineManifest.single.checklist.uncheckedLabel")}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  ) : null;
}
