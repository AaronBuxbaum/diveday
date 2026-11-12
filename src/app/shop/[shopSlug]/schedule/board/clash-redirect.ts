import { sealPersonClashResult } from "@/features/person-clash-result";

export function addClashResult(
  params: URLSearchParams,
  shopId: string,
  tripId: string,
  day: string,
  clashes: readonly { personName: string; otherTitle: string }[] | undefined,
) {
  if (!clashes?.length) return;
  params.set("clashTrip", tripId);
  params.set("clashDay", day);
  params.set("clashResult", sealPersonClashResult(shopId, tripId, clashes));
}
