// i18n-exempt-file: type-only action signature; all visible copy arrives as translated props.
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field } from "@/components/ui/form";

export type PrivateNoteAction = (formData: FormData) => void | Promise<void>;

export type PrivateNoteFormCopy = {
  label: string;
  placeholder?: string;
  add: string;
  adding: string;
};

/**
 * The one staff-only note input used by the diver record, Guests roster, and
 * live manifest. The action decides the note's existing domain scope
 * (person-scoped or booking-scoped); the form deliberately does not create a
 * third client-side note path.
 *
 * `resetKey` remounts the uncontrolled textarea after a successful server
 * action, so the text that just landed cannot be submitted a second time.
 */
export function PrivateNoteForm({
  action,
  hiddenFields,
  resetKey,
  copy,
  rows = 3,
  className = "",
}: {
  action: PrivateNoteAction;
  hiddenFields?: Readonly<Record<string, string>>;
  resetKey?: string | number;
  copy: PrivateNoteFormCopy;
  rows?: number;
  className?: string;
}) {
  return (
    <form key={resetKey} action={action} className={`grid gap-3 ${className}`}>
      {Object.entries(hiddenFields ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Field label={copy.label}>
        <textarea
          name="note"
          required
          maxLength={1_000}
          rows={rows}
          placeholder={copy.placeholder}
          className={controlClass}
        />
      </Field>
      <SubmitButton
        pendingLabel={copy.adding}
        className={buttonClass({
          variant: "secondary",
          size: "sm",
          className: "justify-self-start",
        })}
      >
        {copy.add}
      </SubmitButton>
    </form>
  );
}
