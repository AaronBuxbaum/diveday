/**
 * The one-line sent/error readout under a Today-queue inline action (resend an
 * invoice, resend a booking confirmation). One implementation — the two
 * controls used to carry structurally identical private copies. The caller
 * resolves its action's reason code to words; this only says them, in the
 * shared success/refusal shape.
 */
export function ActionResultNotice({
  status,
  sentMessage,
  errorMessage,
}: {
  status: "idle" | "sent" | "error";
  sentMessage: string;
  /** Required when `status` is "error" — the caller maps its reason code. */
  errorMessage?: string;
}) {
  if (status === "idle") return null;
  return (
    <p
      role="status"
      className={`mt-2 text-sm font-medium ${status === "sent" ? "text-success" : "text-danger"}`}
    >
      {status === "sent" ? (
        <>
          <span aria-hidden="true">✅ </span>
          {sentMessage}
        </>
      ) : (
        errorMessage
      )}
    </p>
  );
}
