"use client";

import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";

interface HomeCTAProps {
  enterDemoAction: (formData: FormData) => Promise<void>;
}

export function HomeCTA({ enterDemoAction }: HomeCTAProps) {
  return (
    <div className="flex flex-col items-start gap-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        <form action={enterDemoAction}>
          <input type="hidden" name="source" value="home-hero" />
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
          href="/onboard"
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
        className="text-sm font-medium text-primary hover:underline"
      >
        See a live schedule →
      </Link>
    </div>
  );
}
