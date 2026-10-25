import type { IncidentWaiverStatus } from "@/lib/incident-export";

/**
 * What a signed waiver says about itself apart from its date: which release,
 * which version, and how it reached the record (and who recorded it).
 */
export type WaiverHeader = {
  title: string;
  version: number;
  signatureMethod: string | null;
  recordedByName: string | null;
};

function headerOf(waiver: IncidentWaiverStatus | null): WaiverHeader | null {
  if (waiver?.state !== "complete" || !waiver.signedAt) return null;
  if (waiver.templateTitle === null || waiver.templateVersion === null) return null;
  return {
    title: waiver.templateTitle,
    version: waiver.templateVersion,
    signatureMethod: waiver.signatureMethod,
    // Only an in-person signature names its recorder in the sentence.
    recordedByName: waiver.signatureMethod === "in_person_attested" ? waiver.recordedByName : null,
  };
}

function sameHeader(a: WaiverHeader, b: WaiverHeader): boolean {
  return (
    a.title === b.title &&
    a.version === b.version &&
    a.signatureMethod === b.signatureMethod &&
    a.recordedByName === b.recordedByName
  );
}

/**
 * **The waiver said once over the evidence list** (visual review 2026-10-24,
 * B52): the release, version and recorder most of the boat's signed waivers
 * share, when at least two do. Every diver's row then carries only its signed
 * date. A waiver that differs in any of the four keeps its whole sentence on
 * its own row (`matchesWaiverHeader`), so nothing that sets one diver apart is
 * folded into a header that is not theirs. The earliest of equally common
 * headers wins, so the choice never depends on anything but the roster order.
 */
export function sharedWaiverHeader(
  waivers: readonly (IncidentWaiverStatus | null)[],
): WaiverHeader | null {
  const tallies: { header: WaiverHeader; count: number }[] = [];
  for (const waiver of waivers) {
    const header = headerOf(waiver);
    if (!header) continue;
    const tally = tallies.find((entry) => sameHeader(entry.header, header));
    if (tally) tally.count += 1;
    else tallies.push({ header, count: 1 });
  }
  let best: { header: WaiverHeader; count: number } | null = null;
  for (const tally of tallies) {
    if (!best || tally.count > best.count) best = tally;
  }
  return best && best.count >= 2 ? best.header : null;
}

/** This diver's waiver is the one the header already states, so its row says only the date. */
export function matchesWaiverHeader(
  waiver: IncidentWaiverStatus | null,
  header: WaiverHeader | null,
): boolean {
  const own = headerOf(waiver);
  return own !== null && header !== null && sameHeader(own, header);
}
