import { checkPublicHost } from "@/lib/notifications";

/**
 * Runs once per server instance before it accepts requests. APP_HOST is
 * optional (many features degrade to "not configured" without it), but a
 * *set* value that is malformed (wrong scheme, embedded credentials, a
 * path/query/fragment) is a deploy-config bug — fail loudly here rather than
 * silently mis-linking waiver/readiness/recap tokens or the Stripe callback.
 */
export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const result = checkPublicHost(process.env.APP_HOST, process.env.NODE_ENV === "production");
  if (result.status === "invalid") {
    throw new Error(`Invalid APP_HOST configuration: ${result.reason}`);
  }
}
