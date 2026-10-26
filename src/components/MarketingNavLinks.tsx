"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { MENU_PANEL, menuRowClass } from "@/components/ui/menu";
import { useMenuDismissalEvents } from "@/components/useMenuDismissal";

/** One set of destinations: inline on desktop, disclosed in the phone header. */
export function MarketingNavLinks({
  links,
  menuLabel,
  compactMobile,
  pending = false,
}: {
  links: readonly { href: string; label: string }[];
  menuLabel: string;
  compactMobile: boolean;
  pending?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const close = useCallback(() => setOpen(false), []);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  useMenuDismissalEvents({ open, close, inside: [trigger, panel], returnFocus: trigger });
  return (
    <div className={`lg:ms-auto ${compactMobile ? "max-lg:hidden" : ""}`}>
      <button
        ref={trigger}
        type="button"
        disabled={pending || !hydrated}
        data-hydrated={!pending && hydrated ? "true" : undefined}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        className={buttonClass({ variant: "ghost", className: "lg:hidden" })}
      >
        {menuLabel}
      </button>
      <div
        ref={panel}
        id={id}
        className={`${open ? "flex" : "hidden"} z-20 flex-col lg:static lg:flex lg:flex-row lg:items-center lg:gap-x-2 max-lg:absolute max-lg:inset-x-6 max-lg:top-full ${MENU_PANEL} lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none`}
      >
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            onClick={close}
            className={`${menuRowClass("quiet", { gutter: false })} max-lg:text-base lg:min-h-11 lg:rounded-lg lg:px-3 lg:py-2 lg:text-sm lg:font-medium lg:whitespace-nowrap`}
          >
            {link.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
