import { refuse } from "./types";
/** An offset is evidence; a host or shop timezone is never a substitute. */
export function computerTime(raw: string) {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/.exec(
      raw,
    );
  if (!match) refuse("invalid_value");
  const [, year, month, day, hour, minute, second = "00", fraction = "", zone] = match;
  const localStart = `${year}-${month}-${day}T${hour}:${minute}:${second}${fraction}`;
  const utc = Date.parse(`${localStart}Z`);
  if (!Number.isFinite(utc) || new Date(utc).toISOString().slice(0, 19) !== localStart.slice(0, 19))
    refuse("invalid_value");
  let offsetMinutes: number | null = null;
  if (zone === "Z") offsetMinutes = 0;
  else if (zone) {
    const hours = Number(zone.slice(1, 3));
    const minutes = Number(zone.slice(4));
    if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) refuse("invalid_value");
    // RFC 3339 -00:00 explicitly means unknown local offset.
    if (zone !== "-00:00") offsetMinutes = (zone[0] === "-" ? -1 : 1) * (hours * 60 + minutes);
  }
  return {
    localStart,
    startInstant:
      offsetMinutes === null ? null : new Date(utc - offsetMinutes * 60_000).toISOString(),
    offsetMinutes,
  };
}
