"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";

interface HomeCTAProps {
  enterDemoAction: () => Promise<void>;
}

export function HomeCTA({ enterDemoAction }: HomeCTAProps) {
  const [demoState, setDemoState] = useState<{ demo: boolean; demoSlug: string | null } | null>(
    null,
  );

  useEffect(() => {
    fetch("/api/demo-check")
      .then((res) => res.json())
      .then((data) => setDemoState(data))
      .catch(() => setDemoState({ demo: false, demoSlug: null }));
  }, []);

  if (demoState?.demo) {
    return (
      <>
        <form action={enterDemoAction}>
          <SubmitButton
            pendingLabel="Spinning up your shop…"
            className="inline-block rounded-lg bg-primary px-5 py-3 font-medium text-primary-foreground transition-colors duration-200 hover:bg-primary-hover disabled:opacity-70"
          >
            Try the live demo
          </SubmitButton>
        </form>
        <Link
          href={`/shop/${demoState.demoSlug}/schedule`}
          className="inline-block rounded-lg border border-border bg-surface px-5 py-3 font-medium transition-colors duration-200 hover:bg-surface-sunken"
        >
          See the demo schedule
        </Link>
      </>
    );
  }

  return (
    <Link
      href="/sign-in"
      className="inline-block rounded-lg bg-primary px-5 py-3 font-medium text-primary-foreground transition-colors duration-200 hover:bg-primary-hover"
    >
      Sign in to your shop
    </Link>
  );
}
