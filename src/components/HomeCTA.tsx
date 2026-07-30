"use client";

import Link from "next/link";
import { FunnelTag } from "@/components/FunnelTag";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { trialHref } from "@/lib/funnel";

interface HomeCTAProps {
  enterDemoAction: (formData: FormData) => Promise<void>;
}

export function HomeCTA({ enterDemoAction }: HomeCTAProps) {
  return (
    <div className="flex flex-col items-start gap-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        <form action={enterDemoAction}>
          <FunnelTag source="home-hero" />
          <SubmitButton
            pendingLabel="Getting your shop ready…"
            className={buttonClass({
              size: "cta",
              className: "cursor-pointer disabled:opacity-70",
            })}
          >
            Try the live demo
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
          Start a trial
        </Link>
      </div>
      <Link
        href="/shop/blue-mantis/schedule"
        className={buttonClass({ variant: "link", className: "px-0" })}
      >
        See a live schedule →
      </Link>
    </div>
  );
}
