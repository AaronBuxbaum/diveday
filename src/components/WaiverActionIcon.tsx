// i18n-exempt-file: icon names are drawn artwork; labels arrive from callers.
import {
  DiveDayIcon,
  type WaiverActionIconName,
  type WaiverDeliveryMarkName,
} from "@/components/StaffDestinationIcon";

export type { WaiverActionIconName, WaiverDeliveryMarkName };

export function WaiverActionIcon({ name }: { name: WaiverActionIconName }) {
  return (
    <DiveDayIcon name={`waiver-action-${name}`} className="size-4 shrink-0" strokeWidth={1.6} />
  );
}

export function WaiverDeliveryMark({ name }: { name: WaiverDeliveryMarkName }) {
  return <DiveDayIcon name={`waiver-mark-${name}`} className="size-3 shrink-0" />;
}
