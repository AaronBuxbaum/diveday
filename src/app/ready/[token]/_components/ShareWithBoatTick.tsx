import { ChoiceRow } from "@/components/ui/form";

/**
 * **"Share with everyone on this boat"** on the recap photo upload (H-20261014-share-photo-with-boat, ADR
 * 20261016-shared-boat-photos). Off by default, and per pick: the boat sees a
 * photo only when the person who took it says so. Its own file because it is
 * an upload's choice, not a stored photo's remove box (`RemovablePhoto`).
 */
export function ShareWithBoatTick({ label }: { label: string }) {
  return (
    <ChoiceRow type="checkbox" name="shareWithBoat" className="text-sm">
      {label}
    </ChoiceRow>
  );
}
