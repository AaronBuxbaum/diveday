import type { ReactNode } from "react";
import { cachedFormatter } from "@/lib/intl-cache";
import type { RollCallCausalContext } from "@/lib/roll-call-causality";
import { DangerDisclosure } from "./ui/disclosure";

export type RollCallEvidenceCopy = {
  heading: string;
  unknownOrder: string;
  unknownDay: string;
  statuses: Record<"boarded" | "not_boarded" | "cleared", string>;
};

/** Original statements are displayed together before crew resolve the named evidence. */
export function RollCallEvidencePanel({
  context,
  copy,
  locale,
  timeZone,
  children,
}: {
  context: RollCallCausalContext;
  copy: RollCallEvidenceCopy;
  locale: string;
  timeZone: string;
  children: ReactNode;
}) {
  if (!context.conflict) return null;
  const format = cachedFormatter("dateTime", Intl.DateTimeFormat, locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone,
  });
  return (
    <DangerDisclosure open className="my-4" summary={copy.heading}>
      {context.orderingUnknown ? <p>{copy.unknownOrder}</p> : null}
      {context.unknownMeetingDay ? <p>{copy.unknownDay}</p> : null}
      <ul className="my-3 space-y-2">
        {context.evidence.map((item) => (
          <li key={item.id}>
            <p className="font-medium">{copy.statuses[item.status]}</p>
            <p>
              {item.recordedByName}{" "}
              <time dateTime={item.occurredAt}>{format.format(new Date(item.occurredAt))}</time>
            </p>
            {item.note ? <p>{item.note}</p> : null}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-3">{children}</div>
    </DangerDisclosure>
  );
}
