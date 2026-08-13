import { EntryShellSkeleton } from "@/components/account/EntryShellSkeleton";

/**
 * Entry-shell-shaped skeleton for shop sign-up (design principle 1) — the
 * trial form reads `searchParams` (the funnel tag and any bounced-back
 * answers) and the negotiated locale, so the shell carries its shape while
 * those resolve.
 */
export default function OnboardLoading() {
  return (
    <EntryShellSkeleton
      eyebrow
      width="lg"
      fields={["shop", "slug", "timezone", "owner", "email", "password"]}
    />
  );
}
