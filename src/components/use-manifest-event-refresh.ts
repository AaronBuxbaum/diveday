import { useEffect } from "react";

/** Refresh after a stream reconnect, where one or more changes may have been missed. */
export function useManifestEventRefresh(
  tripId: string,
  refresh: (options: { manual: boolean }) => void,
) {
  useEffect(() => {
    if (!tripId || typeof EventSource === "undefined") return;
    const source = new EventSource(`/api/trips/${tripId}/manifest-events`);
    let connected = false;
    let failed = false;
    const onOpen = () => {
      const mayHaveMissedEvents = connected || failed;
      connected = true;
      failed = false;
      if (mayHaveMissedEvents && navigator.onLine) refresh({ manual: false });
    };
    const onError = () => {
      failed = true;
    };
    const onChanged = () => {
      if (navigator.onLine) refresh({ manual: false });
    };
    source.addEventListener("open", onOpen);
    source.addEventListener("error", onError);
    source.addEventListener("manifest-changed", onChanged);
    return () => {
      source.removeEventListener("open", onOpen);
      source.removeEventListener("error", onError);
      source.removeEventListener("manifest-changed", onChanged);
      source.close();
    };
  }, [tripId, refresh]);
}
