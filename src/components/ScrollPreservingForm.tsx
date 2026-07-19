"use client";

import { type ComponentProps, useLayoutEffect } from "react";

const STORAGE_KEY = "scuba:preserved-scroll-y";

export function RestorePreservedScroll({ navigationKey }: { navigationKey?: string }) {
  useLayoutEffect(() => {
    // Reading the key intentionally reruns restoration after a redirect updates the notice.
    void navigationKey;
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved === null) return;
    sessionStorage.removeItem(STORAGE_KEY);
    window.scrollTo({ top: Number(saved), behavior: "instant" });
  }, [navigationKey]);

  return null;
}

export function ScrollPreservingForm(props: ComponentProps<"form">) {
  return (
    <form
      {...props}
      onSubmit={(event) => {
        sessionStorage.setItem(STORAGE_KEY, String(window.scrollY));
        props.onSubmit?.(event);
      }}
    />
  );
}
