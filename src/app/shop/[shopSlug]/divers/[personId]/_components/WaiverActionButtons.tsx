"use client";

import { useActionState } from "react";
import {
  IDLE_WAIVER_SEND_STATE,
  type WaiverSendCopy,
} from "@/app/actions/waiver-send-types";
import { sendWaiversAction } from "@/app/actions/waivers";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { DiverProfile } from "./shared";

interface WaiverActionButtonsProps {
  diver: DiverProfile;
  shopSlug: string;
  personId: string;
  t: StaffTranslator;
  copy: WaiverSendCopy;
}

/** Icon-based waiver action buttons arranged horizontally */
export function WaiverActionButtons({
  diver,
  shopSlug,
  personId,
  t,
  copy,
}: WaiverActionButtonsProps) {
  const hasEmail = Boolean(diver.person.email);
  const hasPhone = Boolean(diver.person.phone);
  const [_state, formAction] = useActionState(
    sendWaiversAction.bind(null, shopSlug, "diver", undefined),
    IDLE_WAIVER_SEND_STATE,
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Email button - if email exists */}
      {hasEmail && (
        <form action={formAction} className="contents">
          <input type="hidden" name="personId" value={personId} />
          <SubmitButton
            className={buttonClass({ variant: "secondary", size: "icon" })}
            aria-label={t("divers.stats.sendWaiverViaEmail")}
            title={t("divers.stats.sendWaiverViaEmail")}
            pendingLabel="…"
          >
            <EmailIcon />
          </SubmitButton>
        </form>
      )}

      {/* Phone/SMS button - if phone exists (placeholder for future SMS support) */}
      {hasPhone && (
        <button
          type="button"
          className={buttonClass({ variant: "secondary", size: "icon" })}
          aria-label={t("divers.stats.sendWaiverViaSms")}
          title={t("divers.stats.sendWaiverViaSms")}
          disabled
        >
          <PhoneIcon />
        </button>
      )}

      {/* Link copy button - always available */}
      <form action={formAction} className="contents">
        <input type="hidden" name="personId" value={personId} />
        <input type="hidden" name="exposeLink" value="true" />
        <SubmitButton
          className={buttonClass({ variant: "secondary", size: "icon" })}
          aria-label={t("divers.stats.copyWaiverLink")}
          title={t("divers.stats.copyWaiverLink")}
          pendingLabel="…"
        >
          <LinkIcon />
        </SubmitButton>
      </form>
    </div>
  );
}

/** Email envelope icon, 24px SVG on currentColor */
export function EmailIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-6"
    >
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

/** Phone icon, 24px SVG on currentColor */
export function PhoneIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-6"
    >
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

/** Link/chain icon, 24px SVG on currentColor */
export function LinkIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-6"
    >
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

/** Document/paper icon, 24px SVG on currentColor */
export function DocumentIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-6"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="12" y1="13" x2="12" y2="17" />
      <line x1="10" y1="15" x2="14" y2="15" />
    </svg>
  );
}
