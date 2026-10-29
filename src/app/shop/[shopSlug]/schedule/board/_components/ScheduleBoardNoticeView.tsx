"use client";

import { useEffect, useRef, useState } from "react";
import {
  RescheduleHold,
  type RescheduleNoticeSnapshot,
} from "@/app/shop/[shopSlug]/_components/RescheduleHold";
import { ShopNotice } from "@/components/ShopPageHeader";
import { noticeRole } from "@/lib/staff-notices";
import { clearBoardResultParams } from "./board-search-params";

type BoardNotice = { tone: "success" | "danger" | "warning"; message: string };
type GearNotice = { id: string; message: string };

/** Keeps action-result copy on this visit, then removes replayable result values from the URL. */
export function ScheduleBoardNoticeView({
  notice,
  initialNotice,
  gearMessage,
  resultId,
}: {
  notice: BoardNotice | undefined;
  initialNotice: RescheduleNoticeSnapshot | null;
  gearMessage: string | undefined;
  resultId: string | undefined;
}) {
  const firstGearNotice = gearMessage && resultId ? { id: resultId, message: gearMessage } : null;
  const [gearNotices, setGearNotices] = useState<GearNotice[]>(() =>
    firstGearNotice ? [firstGearNotice] : [],
  );
  const seenGearResults = useRef(new Set(firstGearNotice ? [firstGearNotice.id] : []));
  const [activeNotice, setActiveNotice] = useState(initialNotice);
  const [hasVerifiedHold, setHasVerifiedHold] = useState(Boolean(initialNotice));

  useEffect(() => {
    if (gearMessage && resultId && !seenGearResults.current.has(resultId)) {
      seenGearResults.current.add(resultId);
      setGearNotices((current) => [...current, { id: resultId, message: gearMessage }]);
    }

    const url = clearBoardResultParams(new URL(window.location.href));
    const next = `${url.pathname}${url.search}${url.hash}`;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(window.history.state, "", next);
    }
  }, [gearMessage, resultId]);

  useEffect(() => {
    if (!initialNotice) return;
    setActiveNotice(initialNotice);
    setHasVerifiedHold(true);
  }, [initialNotice]);

  useEffect(() => {
    const clearVisitNotices = () => {
      setGearNotices([]);
      seenGearResults.current.clear();
      setActiveNotice(null);
      setHasVerifiedHold(false);
    };
    const clearOnRestore = (event: PageTransitionEvent) => {
      if (event.persisted) clearVisitNotices();
    };
    window.addEventListener("pagehide", clearVisitNotices);
    window.addEventListener("pageshow", clearOnRestore);
    return () => {
      window.removeEventListener("pagehide", clearVisitNotices);
      window.removeEventListener("pageshow", clearOnRestore);
    };
  }, []);

  const hasGearWarning = gearNotices.length > 0;
  const tone = hasGearWarning
    ? "warning"
    : (notice?.tone ?? (activeNotice ? "success" : undefined));
  if (
    !tone ||
    (!notice && !hasGearWarning && !activeNotice) ||
    (gearMessage && !hasGearWarning && !activeNotice)
  )
    return null;

  return (
    <ShopNotice
      tone={tone}
      role={noticeRole(tone)}
      className="mb-6"
      persistent={hasVerifiedHold}
      occurrenceKey={resultId}
    >
      {gearMessage ? (
        hasGearWarning ? (
          <div className="space-y-1">
            {gearNotices.map((entry) => (
              <p key={entry.id}>{entry.message}</p>
            ))}
          </div>
        ) : null
      ) : (
        notice?.message
      )}
      {activeNotice ? (
        <div className="mt-2">
          <RescheduleHold key={activeNotice.ticket.id} initialNotice={activeNotice} />
        </div>
      ) : null}
    </ShopNotice>
  );
}
