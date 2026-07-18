"use client";

import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";

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
            className="inline-block rounded-lg bg-primary px-5 py-3 font-medium text-primary-foreground transition-colors duration-200 hover:bg-primary-hover disabled:opacity-70 cursor-pointer"
          >
            Try the live demo
          </SubmitButton>
        </form>
        <Link
          href="/sign-in"
          className="inline-block rounded-lg bg-primary px-5 py-3 font-medium text-primary-foreground transition-colors duration-200 hover:bg-primary-hover"
        >
          Sign in to your shop
        </Link>
      </div>
    </div>
  );
}
