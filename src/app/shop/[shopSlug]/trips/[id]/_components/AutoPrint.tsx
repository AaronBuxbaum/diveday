"use client";

import { useEffect } from "react";

type AutoPrintProps = {
  /** A streamed Suspense boundary that must be present before printing. */
  readySelector?: string;
};

function waitForElement(selector: string): Promise<void> {
  if (document.querySelector(selector)) return Promise.resolve();

  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (!document.querySelector(selector)) return;
      observer.disconnect();
      resolve();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.setTimeout(() => {
      observer.disconnect();
      resolve();
    }, 5_000);
  });
}

/** Open the browser's print/save-PDF dialog after streamed content mounts. */
export function AutoPrint({ readySelector }: AutoPrintProps) {
  useEffect(() => {
    let cancelled = false;
    const printWhenReady = async () => {
      if (readySelector) await waitForElement(readySelector);
      await document.fonts?.ready;
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      if (!cancelled) window.print();
    };
    void printWhenReady();
    return () => {
      cancelled = true;
    };
  }, [readySelector]);
  return null;
}
