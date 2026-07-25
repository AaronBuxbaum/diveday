/**
 * Who runs DiveDay itself (20260724-resend-webhook-email-events).
 *
 * There is no platform-admin *role*: every role in this app is shop-scoped
 * (`person_role`), and inventing a global one would put a "can see everything"
 * bit on a row that shop staff can already grant each other. The operator set
 * is configuration instead — an allowlist of email addresses that only whoever
 * deploys the app can change.
 *
 * Fails closed: unset means nobody is a platform admin, so `/admin/**` is
 * unreachable rather than open.
 */

export function platformAdminEmails(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string[] {
  return (env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.includes("@"));
}

export function isPlatformAdminEmail(
  email: string | null | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return false;
  return platformAdminEmails(env).includes(normalized);
}
