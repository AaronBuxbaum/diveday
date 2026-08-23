"use client";

import { usePathname, useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useTransition } from "react";

/**
 * A filter/search form whose controls live in the URL — without reloading the
 * document.
 *
 * Every one of these surfaces was written as a plain `<form method="get">`,
 * deliberately: the URL carries the filter, the server re-renders the list, no
 * client state, pixel-stable for visual regression. All of that is right and
 * all of it is kept. What was not right is the *navigation*: a native GET
 * submit is a full document navigation. The browser tears the page down,
 * re-runs the whole shell, and lands at scroll top — so changing "Has space"
 * on a shop's schedule threw the diver back to the header, and the same
 * happened on every staff search box. On the public schedule the filters
 * auto-submit on change, so it fired on a single tap of a checkbox.
 *
 * This keeps the form a real GET form — before hydration it submits natively
 * and everything still works, so a tap landing in that beat is not lost — and
 * once
 * hydrated intercepts the submit to do the same navigation through the router
 * instead: same URL, same server render, but a client transition that keeps
 * the shell mounted and the viewport where it was (`scroll: false`).
 *
 * `replace` rather than `push` by default: ten filter tweaks are one act, not
 * ten entries a diver has to press Back through to leave the page.
 *
 * Empty values are dropped from the query, so clearing a filter clears it out
 * of the URL rather than leaving `?tripType=` behind. Every consumer already
 * reads an empty string as "no filter" (that is what the native submit
 * produced), so both paths land on the same server render.
 */
export function QueryForm({
  children,
  className = "",
  replace = true,
  /** Extra params to keep in the URL that are not fields in this form. */
  keep,
  ref,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  replace?: boolean;
  keep?: Record<string, string | undefined>;
  /** For a caller that drives its own `requestSubmit()`, e.g. auto-apply filters. */
  ref?: React.Ref<HTMLFormElement>;
} & Omit<React.FormHTMLAttributes<HTMLFormElement>, "method" | "onSubmit" | "className">) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(keep ?? {})) {
      if (value) params.set(key, value);
    }
    for (const [key, value] of new FormData(event.currentTarget).entries()) {
      if (typeof value !== "string") continue;
      // A native GET submit posts empty boxes as `?q=`; dropping them keeps a
      // cleared filter out of the URL entirely. Both read as "no filter".
      if (value === "") params.delete(key);
      else params.set(key, value);
    }
    const query = params.toString();
    startTransition(() => {
      const href = query ? `${pathname}?${query}` : pathname;
      if (replace) router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    });
  }

  return (
    <form
      ref={ref}
      method="get"
      onSubmit={handleSubmit}
      aria-busy={pending}
      // Fixed-size, always-rendered feedback: the form dims while the server
      // re-renders behind it, so a tap is acknowledged without anything moving.
      className={`transition-opacity aria-busy:opacity-60 ${className}`}
      {...rest}
    >
      {children}
    </form>
  );
}
