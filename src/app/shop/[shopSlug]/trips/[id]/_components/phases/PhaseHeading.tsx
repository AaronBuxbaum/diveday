import type { ReactNode } from "react";
import { TripSentenceLine } from "../TripSentenceLine";
import type { tripFrame } from "../trip-frame";
import { LookBackCloseOut } from "./LookBackCloseOut";
import type { PhaseRecordContext } from "./WaterPhase";

export function PhaseHeading({
  frame,
  showDetails,
  cancelled,
  record,
  notBack,
  rollCallHero,
  tripPath,
  strip,
}: {
  frame: ReturnType<typeof tripFrame>;
  showDetails: boolean;
  cancelled: boolean;
  record: PhaseRecordContext;
  notBack: number;
  rollCallHero: boolean;
  tripPath: string;
  strip: ReactNode;
}) {
  if (showDetails) return null;
  const rollCall = rollCallHero
    ? { href: `${tripPath}/manifest`, label: record.t("trips.clock.rollCall") }
    : null;
  const seats = frame.shown === "filling" ? frame.bar : null;
  const lookBack =
    (frame.lookBack && frame.current === "wrapped") || (cancelled && frame.shown !== "wrapped");
  const showSentence = !cancelled && frame.shown !== "water" && frame.shown !== "wrapped";
  return (
    <div className={lookBack ? "space-y-0" : "space-y-6 sm:space-y-10"}>
      {strip}
      {lookBack || showSentence ? (
        <div className="space-y-1">
          {lookBack ? (
            <LookBackCloseOut record={record} cancelled={cancelled} notBack={notBack} />
          ) : null}
          {showSentence ? (
            <TripSentenceLine sentence={frame.sentence} rollCall={rollCall} seats={seats} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
