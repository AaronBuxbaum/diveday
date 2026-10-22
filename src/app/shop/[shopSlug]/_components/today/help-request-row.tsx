import type { StaffTranslator } from "@/i18n/staff-messages";
import { helpRequestMeetingText } from "@/i18n/today-labels";
import type { TodayAction } from "@/lib/today";
import { HelpRequestControl } from "./HelpRequestControl";

/**
 * A help-request row's control, its label and meeting line already in words: the label is the
 * row's own `actionLabel`, so the row and the control can never say two different things.
 */
export function helpRequestControl(
  request: NonNullable<TodayAction["helpRequest"]>,
  label: string,
  t: StaffTranslator,
) {
  const { meetingInstructions, ...rest } = request;
  return (
    <HelpRequestControl
      {...rest}
      label={label}
      meetingLine={meetingInstructions ? helpRequestMeetingText(t, meetingInstructions) : null}
    />
  );
}
