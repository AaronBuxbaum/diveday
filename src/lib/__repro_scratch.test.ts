import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { staffTideWindowText, diverTideWindowText } from "@/i18n/tide-labels";
import { staffTranslator } from "@/i18n/staff-messages";
import { diverTranslator } from "@/i18n/messages";
import { type TidePrediction, tideWindowAt } from "@/lib/tides";
import { formatTime } from "@/lib/format";

const turn = (iso: string, kind: "high" | "low"): TidePrediction => ({
  at: new Date(iso),
  kind,
  heightMeters: kind === "high" ? 0.7 : 0.1,
});
// Carysfort Reef, 2026-07-21, exactly the table the reviewer names.
const DAY = [
  turn("2026-07-21T00:52:00Z", "low"),
  turn("2026-07-21T06:45:00Z", "high"),
  turn("2026-07-21T13:19:00Z", "low"),
  turn("2026-07-21T19:31:00Z", "high"),
  turn("2026-07-22T01:47:00Z", "low"),
];

const lines: unknown[][] = [];
describe("reviewer scenario", () => {
  it("prints what?", () => {
    const arrival = new Date("2026-07-21T14:20:00Z"); // 10:20 EDT
    const w = tideWindowAt(DAY, arrival);
    const time = formatTime(w!.nearestTurn.at, "en-US", "America/New_York");
    lines.push(["phase", w!.phase, "minutesToTurn", w!.minutesToTurn, "kind", w!.nearestTurn.kind]);
    lines.push(["STAFF/none  :", staffTideWindowText(staffTranslator("en-US"), w!, null, time)]);
    lines.push(["STAFF/slack :", staffTideWindowText(staffTranslator("en-US"), w!, "slack", time)]);
    lines.push(["DIVER/slack :", diverTideWindowText(diverTranslator("en-US"), w!, "slack", time)]);
    lines.push(["ES/slack    :", staffTideWindowText(staffTranslator("es-ES"), w!, "slack", time)]);
    writeFileSync("/tmp/claude-0/-home-user-diveday/80ffa606-6945-5cc6-9c2b-55946a36a5f8/scratchpad/out.txt", lines.map((l) => l.join(" ")).join("\n"));
  });
});
