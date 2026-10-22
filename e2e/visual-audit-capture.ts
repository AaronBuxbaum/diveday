import type { Page } from "@playwright/test";

/** The visual suite keeps screenshot settling, probing and viewport ownership. */
export type AuditCapture = (
  page: Page,
  name: string,
  scheme: "light" | "dark",
  options?: { beforeShot?: () => Promise<void> },
) => Promise<void>;

export type AuditPrintCapture = (page: Page, name: string) => Promise<void>;
