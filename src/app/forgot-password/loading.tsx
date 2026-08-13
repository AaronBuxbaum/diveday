import { EntryShellSkeleton } from "@/components/account/EntryShellSkeleton";

/**
 * Entry-shell-shaped skeleton for "reset your password" (design principle 1).
 * The page's own words need the negotiated locale (`requestLocale()`, backed
 * by `headers()`) and its sent-state needs `searchParams`, so neither can be
 * in the static shell — this is what a visitor sees the instant the shell
 * lands, instead of a blank page while the request resolves.
 */
export default function ForgotPasswordLoading() {
  return <EntryShellSkeleton fields={["email"]} />;
}
