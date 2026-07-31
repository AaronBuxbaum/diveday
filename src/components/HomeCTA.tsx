"use client";

import Link from "next/link";
import { FunnelTag } from "@/components/FunnelTag";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { trialHref } from "@/lib/funnel";

interface HomeCTAProps {
  enterDemoAction: (formData: FormData) => Promise<void>;
  /** The demo shop's public schedule, tagged for attribution — see `scheduleAttributionHref`. */
  scheduleHref: string;
  copy: {
    gettingReady: string;
    tryDemo: string;
    startTrial: string;
    seeLiveSchedule: string;
  };
}

export function HomeCTA({ enterDemoAction, scheduleHref, copy }: HomeCTAProps) {
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
      <Link href={scheduleHref} className={buttonClass({ variant: "link", className: "px-0" })}>
        {copy.seeLiveSchedule}
      </Link>
    </div>
  );
}
