import type { ParsedComputerDive } from "@/lib/computer-import";

type Seen = { localStart?: unknown; localDate?: unknown; startInstant?: unknown };

function originalDate(record: Seen) {
  if (typeof record.localDate === "string") return record.localDate;
  return typeof record.localStart === "string" ? record.localStart.slice(0, 10) : null;
}

/**
 * Keyed lookup for "is this dive probably one we already hold": same start instant, same local
 * start, or the same calendar day when either side only knows the date. Adding is O(1) and
 * matching is O(1), so a preview costs the file's dives plus the diver's history, not their product.
 */
export function createDuplicateIndex() {
  const instants = new Set<unknown>();
  const starts = new Set<unknown>();
  const days = new Set<string>();
  const datedDays = new Set<string>();
  return {
    add(prior: Seen) {
      if (prior.startInstant != null) instants.add(prior.startInstant);
      if (prior.localStart != null) starts.add(prior.localStart);
      const day = originalDate(prior);
      if (day !== null) {
        days.add(day);
        if (prior.localDate) datedDays.add(day);
      }
    },
    matches(record: ParsedComputerDive) {
      if (record.startInstant !== null && instants.has(record.startInstant)) return true;
      if (record.localStart !== null && starts.has(record.localStart)) return true;
      const day = originalDate(record);
      if (day === null) return false;
      return record.localDate ? days.has(day) : datedDays.has(day);
    },
  };
}
