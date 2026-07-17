"use client";

import { useEffect } from "react";

/**
 * Makes notice/error query params one-shot: the server renders the banner,
 * then this strips the params from the URL so refresh and back-navigation
 * don't replay a stale message as if it just happened.
 */
export function FlashParams({ params }: { params: string[] }) {
  useEffect(() => {
    const url = new URL(window.location.href);
    let changed = false;
    for (const key of params) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    }
    if (changed) window.history.replaceState(null, "", url);
  }, [params]);
  return null;
}
