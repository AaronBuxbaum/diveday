import {
  type NotificationProvider,
  type SesConfig,
  sesNotificationProvider,
} from "@/lib/notifications";

/** Candidate transport for safety-review notices. The worker must stay disabled
 * until real transport cancellation and bounded transaction lifetime are proven.
 * This is deliberately not branded as an approved production worker provider. */
export function singleAttemptSafetyReviewProvider(config: SesConfig): NotificationProvider {
  const inner = sesNotificationProvider(config, { maxAttempts: 1 });
  return {
    async send(notification, options) {
      if (notification.kind !== "unresolved_safety_evidence")
        return { status: "failed", retryable: false, errorCode: "invalid_notification" };
      // A request which arrives here after preflight expired must not start SES.
      if (!options?.signal || options.signal.aborted)
        return { status: "failed", retryable: false, errorCode: "aborted_before_send" };
      return inner.send(notification, { signal: options.signal });
    },
  };
}
