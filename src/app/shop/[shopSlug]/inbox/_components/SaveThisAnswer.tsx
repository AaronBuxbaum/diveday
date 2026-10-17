import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";

/**
 * **"Save this answer"**, under a reply that just went out (fifth loop, item
 * 15), so the shop's saved answers write themselves from real replies. Posts
 * the reply's id and nothing else; the action reads the words back from the
 * stored reply and takes the diver's name out of them.
 */
export function SaveThisAnswer({
  replyId,
  action,
  label,
  pendingLabel,
}: {
  replyId: string;
  action: (formData: FormData) => Promise<void>;
  label: string;
  pendingLabel: string;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="replyId" value={replyId} />
      <SubmitButton
        pendingLabel={pendingLabel}
        className={buttonClass({ variant: "link", size: "sm", flush: true })}
      >
        {label}
      </SubmitButton>
    </form>
  );
}
