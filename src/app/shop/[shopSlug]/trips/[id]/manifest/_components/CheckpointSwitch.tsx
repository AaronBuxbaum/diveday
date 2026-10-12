import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { rollCallCheckpointShortText, rollCallCheckpointText } from "@/i18n/manifest-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { RollCallCheckpoint } from "@/lib/manifests";

/** The checkpoint switch: departure, then one stop after each planned dive. */
export function CheckpointSwitch({
  checkpoints,
  checkpoint,
  shopSlug,
  tripId,
  t,
}: {
  checkpoints: readonly RollCallCheckpoint[];
  checkpoint: RollCallCheckpoint;
  shopSlug: string;
  tripId: string;
  t: StaffTranslator;
}) {
  return (
    <>
      {/* A segmented control, not a row of buttons: the active checkpoint used
        to wear the same filled-primary costume as "Mark boarded", which gave
        the page a second primary that was not an action at all (principle
        8). The same shared track the grouping switches use (`SegmentedControl`),
        at boat size because this row is switched at the rail. */}
      <SegmentedControl
        ariaLabel={t("manifest.checkpointNavAriaLabel")}
        items={checkpoints.map((value) => ({
          key: value,
          label: rollCallCheckpointText(t, value),
          // Below `sm` the full names overran a 390px track and the row read as
          // two — the one segmented control in the app that did (issue #1320).
          // This is the call site that earns the short form, and what makes it
          // a handle rather than a rename is `DiverRollCall`'s heading
          // underneath: the condition is spelled out over
          // `rollCallCheckpointShortText`.
          shortLabel: rollCallCheckpointShortText(t, value),
          href: `/shop/${shopSlug}/trips/${tripId}/manifest?checkpoint=${value}`,
        }))}
        currentKey={checkpoint}
        size="boat"
        currentIsLink
        ariaCurrentValue="true"
        scroll={false}
        className="mt-7"
      />
    </>
  );
}
