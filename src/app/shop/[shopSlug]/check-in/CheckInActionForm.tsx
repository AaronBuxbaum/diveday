"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef } from "react";
import { QueueRowButton } from "./QueueRowButton";

type CheckInAction = (formData: FormData) => Promise<{ ok: true }>;

/**
 * Check-in is a high-frequency toggle, so a successful write refreshes the
 * server-rendered row in place. Keeping the action inside a client form lets
 * Next refresh the data without redirecting the document to the top of the
 * queue, while QueueRowButton still gets the shared pending state.
 */
export function CheckInActionForm({
  action,
  bookingId,
  ariaLabel,
  trailing,
  pendingTrailing,
  className,
  children,
}: {
  action: CheckInAction;
  bookingId: string;
  ariaLabel: string;
  trailing: React.ReactNode;
  pendingTrailing: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const scrollY = useRef(0);
  const [result, formAction] = useActionState(
    async (_previous: { ok: true } | null, formData: FormData) => action(formData),
    null,
  );

  useEffect(() => {
    if (!result?.ok) return;
    router.refresh();
    // Refresh is scroll-preserving in Next, and this explicit restoration also
    // covers the browsers that briefly reset the viewport while the server
    // component tree is replaced.
    window.requestAnimationFrame(() => window.scrollTo({ top: scrollY.current, behavior: "auto" }));
  }, [result, router]);

  return (
    <form
      action={formAction}
      onSubmit={() => {
        scrollY.current = window.scrollY;
      }}
    >
      <input type="hidden" name="bookingId" value={bookingId} />
      <QueueRowButton
        ariaLabel={ariaLabel}
        className={className}
        trailing={trailing}
        pendingTrailing={pendingTrailing}
      >
        {children}
      </QueueRowButton>
    </form>
  );
}
