import { StatusMark } from "@/components/ui/StatusMark";

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
      className={`mt-2 inline-flex items-center gap-1.5 text-sm font-medium ${status === "sent" ? "text-success" : "text-danger"}`}
    >
      <StatusMark variant={status === "sent" ? "success" : "danger"} />
      <span>{status === "sent" ? sentMessage : errorMessage}</span>
    </p>
  );
}
