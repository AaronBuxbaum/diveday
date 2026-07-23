import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/form";

/**
 * The crew-authored post-trip shout-out. Diver-facing and post-trip, so it sits
 * apart from the pre-trip conditions briefing: it rides along on every diver's
 * recap once the trip departs (20260723-post-trip-recap follow-up). Blank sends
 * none — the recap simply omits the block.
 */
export function RecapNoteSection({
  action,
  shoutout,
}: {
  action: (formData: FormData) => void;
  shoutout: string | null;
}) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold">Post-trip recap note</h2>
      <p className="mt-1 text-sm text-muted">
        A short shout-out from the crew, shown on every diver's recap after this trip departs. Leave
        it blank to send none.
      </p>
      <form action={action} className="mt-3 flex flex-col gap-3">
        <textarea
          name="recapShoutout"
          rows={3}
          maxLength={400}
          defaultValue={shoutout ?? ""}
          placeholder="Killer vis today — thanks for diving with us. Come back for the wreck next month!"
          className={controlClass}
        />
        <SubmitButton pendingLabel="Saving…" className={buttonClass({ className: "self-start" })}>
          Save recap note
        </SubmitButton>
      </form>
    </section>
  );
}
