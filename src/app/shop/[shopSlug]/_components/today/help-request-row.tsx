import type { HandledHelpRequest } from "@/db/help-requests";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { handledHelpRequestText, helpRequestMeetingText } from "@/i18n/today-labels";
import { formatTime } from "@/lib/format";
import type { TodayAction } from "@/lib/today";
import {
  HandledHelpRequests,
  type HandledHelpRow,
  HelpRequestControl,
  HelpRequestProvider,
} from "./HelpRequestControl";
import { helpRequestCopy } from "./help-request-copy";

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

/**
 * The Today "Handled" line: this morning's handled requests, collapsed, each with the Reopen that
 * runs the undo transition. Nothing when none is handled.
 */
function HandledHelp({
  requests,
  t,
  locale,
  timeZone,
}: {
  requests: readonly HandledHelpRequest[];
  t: StaffTranslator;
  locale: string;
  timeZone: string;
}) {
  const rows: HandledHelpRow[] = requests.map((request) => ({
    requestId: request.id,
    revision: request.revision,
    helperPersonId: request.helperPersonId,
    line: handledHelpRequestText(t, {
      kind: request.kind,
      personName: request.personName,
      tripLabel: `${request.tripTitle} · ${formatTime(request.startsAt, locale, timeZone)}`,
      helperPersonName: request.helperPersonName,
    }),
    reopenLabel: t("today.helpRequest.handled.reopen"),
    reopenAriaLabel: t("today.helpRequest.handled.reopenFor", { name: request.personName }),
  }));
  return (
    <HandledHelpRequests
      summary={t("today.helpRequest.handled.summary", { count: rows.length })}
      rows={rows}
    />
  );
}

/** Today's help-request outcomes in one provider: the rows' controls, the undo toast, the Handled line. */
export function HelpRequestSection({
  children,
  handled,
  t,
  locale,
  timeZone,
}: {
  children: React.ReactNode;
  handled: readonly HandledHelpRequest[];
  t: StaffTranslator;
  locale: string;
  timeZone: string;
}) {
  return (
    <HelpRequestProvider copy={helpRequestCopy(t)}>
      {children}
      <HandledHelp requests={handled} t={t} locale={locale} timeZone={timeZone} />
    </HelpRequestProvider>
  );
}
