import { computerTime } from "./time";
import { finite, type ParsedComputerDive, refuse } from "./types";
import { child, children, descendants, value, type XmlNode } from "./xml";

function quantity(
  raw: string | undefined,
  kind: "depth" | "temperature" | "pressure" | "volume",
): number | null {
  if (!raw) return null;
  const m = /^([+-]?[\d.]+)\s+(m|ft|C|F|bar|psi|l)$/.exec(raw);
  if (!m) refuse("unknown_units");
  const n = finite(m[1], kind === "temperature" ? -100 : 0, 10000);
  if (n === null) refuse("invalid_value");
  const unit = m[2];
  if (kind === "depth" && (unit === "m" || unit === "ft")) return unit === "ft" ? n * 0.3048 : n;
  if (kind === "temperature" && (unit === "C" || unit === "F"))
    return unit === "F" ? ((n - 32) * 5) / 9 : n;
  if (kind === "pressure" && (unit === "bar" || unit === "psi"))
    return unit === "psi" ? n * 0.0689475729 : n;
  if (kind === "volume" && unit === "l") return n;
  return refuse("unknown_units");
}
function duration(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = /^(\d+):(\d{2}) min$/.exec(raw);
  if (m) {
    const seconds = Number(m[2]);
    if (seconds > 59) refuse("invalid_value");
    return finite(String(Number(m[1]) * 60 + seconds), 0, 604800);
  }
  const s = /^(\d+(?:\.\d+)?) s$/.exec(raw);
  if (s) return finite(s[1], 0, 604800);
  return refuse("unknown_units");
}
function fraction(raw: string | undefined) {
  if (raw === undefined) return null;
  if (!raw.endsWith("%")) refuse("unknown_units");
  const p = finite(raw.slice(0, -1), 0, 100);
  return p === null ? null : p / 100;
}
export function parseSubsurface(root: XmlNode): ParsedComputerDive[] {
  return descendants(root, "dive").flatMap((dive) => {
    const recordings = children(dive, "divecomputer");
    return (recordings.length ? recordings : [dive]).map((recording, index) => {
      const date = recording.attrs.date ?? dive.attrs.date;
      const rawTime = recording.attrs.time ?? dive.attrs.time;
      if (!date || !rawTime) refuse("invalid_value");
      // Subsurface serializes wall time without a timezone; even UTC-looking values remain unknown.
      const time = computerTime(`${date}T${rawTime.padStart(8, "0")}`);
      const gases = children(dive, "cylinder").map((cylinder, gasIndex) => {
        const oxygenFraction = fraction(cylinder.attrs.o2);
        const heliumFraction = fraction(cylinder.attrs.he);
        if ((oxygenFraction ?? 0) + (heliumFraction ?? 0) > 1.000001) refuse("invalid_value");
        return { id: String(gasIndex), oxygenFraction, heliumFraction };
      });
      const tanks = children(dive, "cylinder").map((cylinder, gasIndex) => ({
        gasId: String(gasIndex),
        volumeLiters: quantity(cylinder.attrs.size, "volume"),
        startPressureBar: quantity(cylinder.attrs.start, "pressure"),
        endPressureBar: quantity(cylinder.attrs.end, "pressure"),
      }));
      const samples = children(recording, "sample").map((sample) => {
        const seconds = duration(sample.attrs.time);
        const depthMeters = quantity(sample.attrs.depth, "depth");
        const temperatureC = quantity(sample.attrs.temp, "temperature");
        if (seconds === null || depthMeters === null) refuse("invalid_value");
        return { seconds, depthMeters, ...(temperatureC === null ? {} : { temperatureC }) };
      });
      const depth = child(recording, "depth") ?? child(dive, "depth");
      const rawDepth = depth?.attrs.max;
      const units = new Set(
        [rawDepth, ...children(recording, "sample").map((s) => s.attrs.depth)]
          .filter(Boolean)
          .map((s) => s?.split(" ").at(-1)),
      );
      if (units.size > 1) refuse("unknown_units");
      const depthUnit = units.has("ft") ? "ft" : "m";
      const temperatureUnits = new Set(
        children(recording, "sample").flatMap((s) =>
          s.attrs.temp ? [s.attrs.temp.trim().split(/\s+/).at(-1)] : [],
        ),
      );
      const pressureUnits = new Set(
        children(dive, "cylinder").flatMap((c) =>
          [c.attrs.start, c.attrs.end].filter(Boolean).map((s) => s?.trim().split(/\s+/).at(-1)),
        ),
      );
      if (temperatureUnits.size > 1 || pressureUnits.size > 1) refuse("unknown_units");
      const temperatureUnit = temperatureUnits.has("F")
        ? "F"
        : temperatureUnits.has("C")
          ? "C"
          : null;
      const pressureUnit = pressureUnits.has("psi")
        ? "psi"
        : pressureUnits.has("bar")
          ? "bar"
          : null;
      const device =
        recording === dive ? null : (recording.attrs.model ?? value(recording, "model") ?? null);
      return {
        sourceFormat: "subsurface",
        sourceId: recording.attrs.diveid
          ? `${recording.attrs.deviceid ?? "unknown"}:${recording.attrs.diveid}`
          : dive.attrs.number
            ? `${dive.attrs.number}:${index}`
            : null,
        device,
        ...time,
        durationSeconds: duration(recording.attrs.duration ?? dive.attrs.duration),
        maxDepthMeters: quantity(rawDepth, "depth"),
        samples,
        gases,
        tanks,
        sourceUnits: { depth: depthUnit, temperature: temperatureUnit, pressure: pressureUnit },
        warnings: ["timezone_unknown", ...(recordings.length > 1 ? ["multiple_recordings"] : [])],
      } satisfies ParsedComputerDive;
    });
  });
}
