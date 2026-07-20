"use client";

import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";

interface HomeCTAProps {
  enterDemoAction: () => Promise<void>;
}

export function HomeCTA({ enterDemoAction }: HomeCTAProps) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        <form action={enterDemoAction}>
          <SubmitButton
            pendingLabel="Spinning up your shop…"
            className={buttonClass({
              size: "lg",
              className: "cursor-pointer py-3 text-base disabled:opacity-70",
            })}
          >
            Try the live demo
          </SubmitButton>
        </form>
        <Link
          href="/sign-in"
          className={buttonClass({
            variant: "secondary",
            size: "lg",
            className: "border-border-strong py-3 text-base",
          })}
        >
          Sign in to your shop
        </Link>
      </div>
    </div>
  );
}
