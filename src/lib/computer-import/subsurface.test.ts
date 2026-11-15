import { describe, expect, it } from "vitest";
import { parseComputerFile } from "./index";

const parse = (computers: string) =>
  parseComputerFile(
    new TextEncoder().encode(
      `<divelog program="subsurface"><dives><dive date="2026-08-01" time="12:00:00" duration="30:00 min">${computers}</dive></dives></divelog>`,
    ),
  );
const recording = (attributes: string) =>
  `<divecomputer model="Same model" ${attributes}><depth max="20.0 m"/><sample time="0:00 min" depth="0.0 m"/><sample time="30:00 min" depth="0.0 m"/></divecomputer>`;
describe("Subsurface recording identity", () => {
  it("preserves different device IDs without a dive ID or dive number", () => {
    const dives = parse(recording('deviceid="A"') + recording('deviceid="B"'));
    expect(dives.map((d) => d.deviceId)).toEqual(["A", "B"]);
    expect(JSON.stringify(dives[0])).not.toBe(JSON.stringify(dives[1]));
  });
  it("keeps anonymous recordings distinct with their original recording index", () => {
    const dives = parse(recording("") + recording(""));
    expect(dives.map((d) => d.deviceId)).toEqual([null, null]);
    expect(dives.map((d) => d.recordingIndex)).toEqual([0, 1]);
    expect(dives.map((d) => d.sourceId)).toEqual([null, null]);
    expect(JSON.stringify(dives[0])).not.toBe(JSON.stringify(dives[1]));
    expect(parse(recording("") + recording(""))).toEqual(dives);
  });
});
