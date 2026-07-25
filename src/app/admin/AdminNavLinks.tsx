"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const linkClass =
  "inline-flex min-h-11 items-center rounded-xl px-2 py-2 text-sm font-medium transition-colors duration-200 hover:bg-surface-sunken hover:text-foreground sm:px-3";

/** Addresses is operator-only, so a mailbox member never sees a link that 404s. */
export function AdminNavLinks({
  canManageAddresses,
  className = "",
}: {
  canManageAddresses: boolean;
  className?: string;
}) {
  const pathname = usePathname();
  const links = [
    { label: "Inbox", href: "/admin/inbox" },
    ...(canManageAddresses ? [{ label: "Addresses", href: "/admin/mailboxes" }] : []),
  ];

  return (
    <nav aria-label="Console" className={`flex min-w-0 items-center gap-0.5 sm:gap-1 ${className}`}>
      {links.map(({ label, href }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            className={`${linkClass} ${active ? "bg-primary/10 text-primary" : "text-muted"}`}
            aria-current={active ? "page" : undefined}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
