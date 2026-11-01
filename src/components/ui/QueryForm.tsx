"use client";

import { usePathname, useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useTransition } from "react";

/**
 * A filter/search form whose URL carries its state. Keep native GET submission
 * before hydration; hydrated submits use router navigation with `scroll: false`.
 * Navigation replaces by default, with `push` available when a caller wants a
 * history entry. Hydrated submits omit empty fields and preserve nonempty
 * `keep` params; native GET submits the form's own controls.
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
