"use client";

import { useRouter } from "next/navigation";
import { PullToRefresh, type PullToRefreshCopy } from "@/components/PullToRefresh";

export function CheckInQueueRefresh({
  copy,
  children,
}: {
  copy: PullToRefreshCopy;
  children: React.ReactNode;
}) {
  const router = useRouter();

  return (
    <PullToRefresh copy={copy} onRefresh={async () => router.refresh()}>
      {children}
    </PullToRefresh>
  );
}
