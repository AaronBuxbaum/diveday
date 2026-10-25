import { RowMenu } from "@/components/RowMenu";
import { SubmitButton } from "@/components/SubmitButton";
import { menuRowClass } from "@/components/ui/menu";

/**
 * A phone shift's Remove, in the shift's own "⋯" (visual review A40), not a
 * column of Remove buttons down the phone's right edge.
 */
export function ShiftRemoveMenu({
  label,
  shiftId,
  words,
  action,
}: {
  /** Names the shift: whose, which day. */
  label: string;
  shiftId: string;
  words: { remove: string; removing: string };
  action: (formData: FormData) => void;
}) {
  return (
    <RowMenu label={label}>
      <form action={action}>
        <input type="hidden" name="shiftId" value={shiftId} />
        <SubmitButton
          pendingLabel={words.removing}
          className={menuRowClass("danger", { gutter: false })}
        >
          {words.remove}
        </SubmitButton>
      </form>
    </RowMenu>
  );
}
