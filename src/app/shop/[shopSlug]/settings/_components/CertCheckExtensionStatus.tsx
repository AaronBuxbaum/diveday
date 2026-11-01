// i18n-exempt-file: every label arrives as an already-translated prop.
"use client";

import { useCertCheckExtensionPresence } from "@/components/useCertCheckExtension";
import { fill } from "@/i18n/fill";
import { MIN_EXTENSION_VERSION } from "@/lib/cert-check-extension";

/**
 * Whether this browser has the DiveDay extension, read from the marker its
 * content script sets on the page (H-20261008-cert-check-extension), and whether it is a copy DiveDay
 * talks to (`MIN_EXTENSION_VERSION`). Per browser, not per shop: the
 * extension lives in the staffer's browser, and the desk computer can have it
 * while a phone never will. An older copy is told to update: until it does,
 * every check falls back to the agency's link.
 */
export function CertCheckExtensionStatus({
  added,
  notAdded,
  outdated,
}: {
  /** A template: `{version}`. */
  added: string;
  notAdded: string;
  /** A template: `{version}` and `{minimum}`. */
  outdated: string;
}) {
  const presence = useCertCheckExtensionPresence();
  if (presence.state === "absent") return <>{notAdded}</>;
  if (presence.state === "outdated") {
    return <>{fill(outdated, { version: presence.version, minimum: MIN_EXTENSION_VERSION })}</>;
  }
  return <>{fill(added, { version: presence.version })}</>;
}
