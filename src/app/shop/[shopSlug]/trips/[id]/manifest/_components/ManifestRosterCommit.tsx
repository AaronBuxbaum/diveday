"use client";
import { useLayoutEffect } from "react";
import { markManifestRosterCommitted } from "@/components/manifest-stale-generation";

/** Acknowledge the committed server view containing both the roster and paper. */
export function ManifestRosterCommit({
  tripId,
  renderId,
  renderToken,
  checkpoint,
}: {
  tripId: string;
  renderId: string;
  renderToken?: string;
  checkpoint: string;
}) {
  useLayoutEffect(() => {
    if (!renderToken) return;
    return markManifestRosterCommitted(tripId, renderId, renderToken, checkpoint);
  }, [tripId, renderId, renderToken, checkpoint]);
  return null;
}
