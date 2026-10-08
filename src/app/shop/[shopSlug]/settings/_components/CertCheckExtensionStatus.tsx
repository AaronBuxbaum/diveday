// i18n-exempt-file: both labels arrive as already-translated props.
"use client";

import { useCertCheckExtension } from "@/components/useCertCheckExtension";

/**
 * Whether this browser has the DiveDay extension, read from the marker its
 * content script sets on the page (H-105). Per browser, not per shop: the
 * extension lives in the staffer's browser, and the desk computer can have it
 * while a phone never will.
 */
export function CertCheckExtensionStatus({ added, notAdded }: { added: string; notAdded: string }) {
  return <>{useCertCheckExtension() ? added : notAdded}</>;
}
