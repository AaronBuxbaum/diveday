"use client";

import { usePathname } from "next/navigation";
import { type SectionTab, SectionTabs } from "@/components/SectionTabs";

export function InboxTabs({ label, tabs }: { label: string; tabs: SectionTab[] }) {
  const pathname = usePathname();
  const current = tabs.find((tab) => tab.href === pathname)?.id ?? "inbox";
  return <SectionTabs label={label} tabs={tabs} current={current} />;
}
