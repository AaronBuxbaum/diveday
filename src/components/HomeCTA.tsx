"use client";

import Link from "next/link";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { FunnelTag } from "@/components/FunnelTag";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import type { DemoRoleId } from "@/lib/demo-roles";
import { trialHref } from "@/lib/funnel";

export interface HomeDemoRoleOption {
  id: DemoRoleId;
  icon: string;
  title: string;
  tryThis: string;
  ariaLabel: string;
}

interface HomeCTAProps {
  enterDemoAction: (formData: FormData) => Promise<void>;
  /** The demo shop's public schedule, tagged for attribution — see `scheduleAttributionHref`. */
  scheduleHref: string;
  /** The five demo roles, in display order — see `demo.roles.*` in the message bundle. */
  roleOptions: HomeDemoRoleOption[];
  copy: {
    gettingReady: string;
    tryDemo: string;
    startTrial: string;
    seeLiveSchedule: string;
    enterAsLabel: string;
  };
}

/**
 * One role option in the picker below the primary CTA. Its own `<form>` (one
 * per role) so each button's in-flight state is independent, and so the
 * click needs nothing beyond a name/value pair the server action already
 * reads (`enterDemoAction`'s `role` field).
 */
function RoleOptionButton({
  role,
  pendingLabel,
  onPreview,
}: {
  role: HomeDemoRoleOption;
  pendingLabel: string;
  onPreview: (tryThis: string | null) => void;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="role"
      value={role.id}
      disabled={pending}
      aria-label={role.ariaLabel}
      aria-busy={pending}
      onMouseEnter={() => onPreview(role.tryThis)}
      onMouseLeave={() => onPreview(null)}
      onFocus={() => onPreview(role.tryThis)}
      onBlur={() => onPreview(null)}
      className={buttonClass({
        variant: "secondary",
        size: "sm",
        className: "cursor-pointer gap-1.5 disabled:opacity-70",
      })}
    >
      <span aria-hidden="true">{role.icon}</span>
      {pending ? pendingLabel : role.title}
    </button>
  );
}

export function HomeCTA({ enterDemoAction, scheduleHref, roleOptions, copy }: HomeCTAProps) {
  // What the hovered/focused role button is for, surfaced under the picker —
  // the same "Try:" prompt the in-app role switcher shows once you're already
  // inside the demo (docs/product/archive/ux-personas-20260730-findings.md #103).
  const [preview, setPreview] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-start gap-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        <form action={enterDemoAction}>
          <FunnelTag source="home-hero" />
          <SubmitButton
            pendingLabel={copy.gettingReady}
            className={buttonClass({
              size: "cta",
              className: "cursor-pointer disabled:opacity-70",
            })}
          >
            {copy.tryDemo}
          </SubmitButton>
        </form>
        <Link
          href={trialHref("home-hero")}
          className={buttonClass({
            variant: "secondary",
            size: "cta",
            className: "border-border-strong",
          })}
        >
          {copy.startTrial}
        </Link>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold tracking-wide text-muted uppercase">
          {copy.enterAsLabel}
        </span>
        <form action={enterDemoAction} className="flex flex-wrap gap-1.5">
          <FunnelTag source="home-hero" />
          {roleOptions.map((role) => (
            <RoleOptionButton
              key={role.id}
              role={role}
              pendingLabel={copy.gettingReady}
              onPreview={setPreview}
            />
          ))}
        </form>
        {/* Reserves its line so the picker's height never jumps on hover/focus. */}
        <p aria-live="polite" className="min-h-[1.1rem] text-xs text-muted">
          {preview}
        </p>
      </div>

      <Link href={scheduleHref} className={buttonClass({ variant: "link", className: "px-0" })}>
        {copy.seeLiveSchedule}
      </Link>
    </div>
  );
}
