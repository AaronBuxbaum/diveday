import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { controlClass, Field, FieldActions, FormStatus } from "@/components/ui/form";
import { groupLabelClass } from "@/components/ui/ledger";
import type { EmbedSet, EmbedSetKind } from "@/db/schema";
import type { FormNotice } from "@/lib/staff-notices";
import { createEmbedSetAction, deleteEmbedSetAction, updateEmbedSetAction } from "./actions";

/** One thing a list can hold: a departure by id, or a course by slug. */
export type EmbedSetCandidate = { id: string; label: string };

export type EmbedSetsCopy = {
  title: string;
  nameLabel: string;
  /** An example per kind, so the courses form is not prompting for a boat. */
  namePlaceholder: Record<EmbedSetKind, string>;
  membersLabel: string;
  add: string;
  /** The disclosure that opens a create form, which there is one of per kind. */
  addNamed: (kind: string) => string;
  save: string;
  saving: string;
  /**
   * Both take the list's name because there is one of these per row, and a
   * page of buttons all reading "Delete" names nothing (the #779 precedent).
   * Functions rather than a template the component fills in, so the
   * interpolation stays with the translator that owns the sentence.
   */
  deleteNamed: (name: string) => string;
  deleteConfirm: (name: string) => string;
  kinds: Record<EmbedSetKind, string>;
};

/**
 * **The shop's named embed lists** (issue #1284): "our three beginner boats",
 * "the wreck week". A list is a name plus a selection, and every snippet
 * pointing at it follows the selection — which is the whole reason the members
 * are stored here rather than encoded into the paste.
 *
 * A Server Component on purpose: it reads its words through the page's own
 * `staffTranslator`, so no copy crosses to the browser and the forms are three
 * plain `<form action={…}>` posts with no client state to keep in step.
 *
 * One create form per kind rather than a kind picker, because the members a
 * shop is choosing from are different lists: switching a `<select>` would have
 * to swap the checkboxes under it, which is a client interaction bought for a
 * choice a shop makes once per list.
 */
export function EmbedSets({
  shopSlug,
  sets,
  trips,
  courses,
  notice,
  copy,
}: {
  shopSlug: string;
  sets: readonly EmbedSet[];
  trips: readonly EmbedSetCandidate[];
  courses: readonly EmbedSetCandidate[];
  notice?: FormNotice;
  copy: EmbedSetsCopy;
}) {
  const candidates = (kind: EmbedSetKind) => (kind === "trip" ? trips : courses);
  return (
    <SectionCard padding="lg" title={copy.title}>
      <div className="space-y-8">
        {/* One status for the card rather than one per form: the redirect lands
            back at the top of the page, and the reader who just saved is
            looking at this heading, not at whichever of five forms they used. */}
        <FormStatus tone={notice?.tone}>{notice?.text}</FormStatus>
        {sets.map((set) => (
          <div key={set.id} className="space-y-3 rounded-inset border border-border p-4">
            <p className={groupLabelClass()}>{copy.kinds[set.kind]}</p>
            <form action={updateEmbedSetAction} className="space-y-4">
              <input type="hidden" name="shopSlug" value={shopSlug} />
              <input type="hidden" name="setId" value={set.id} />
              <Field label={copy.nameLabel}>
                <input
                  type="text"
                  name="name"
                  defaultValue={set.name}
                  maxLength={80}
                  required
                  className={controlClass}
                />
              </Field>
              <Field label={copy.membersLabel}>
                <MemberChecklist
                  name={`${set.id}-member`}
                  candidates={candidates(set.kind)}
                  selected={set.memberIds}
                />
              </Field>
              <FieldActions>
                <SubmitButton className={buttonClass()} pendingLabel={copy.saving}>
                  {copy.save}
                </SubmitButton>
              </FieldActions>
            </form>
            <form action={deleteEmbedSetAction}>
              <input type="hidden" name="shopSlug" value={shopSlug} />
              <input type="hidden" name="setId" value={set.id} />
              <SubmitButton
                className={buttonClass({ variant: "danger", size: "sm" })}
                pendingLabel={copy.saving}
                confirmMessage={copy.deleteConfirm(set.name)}
              >
                {copy.deleteNamed(set.name)}
              </SubmitButton>
            </form>
          </div>
        ))}

        {/* Behind a disclosure, and one per kind. A shop names a list once and
            then edits it for a season, so the two create forms are the rarest
            thing on this card and the tallest — left open they doubled its
            height and put two identical "Name" fields under two identical
            group labels, which is the confusion the summary's own words fix. */}
        {(["trip", "course"] as const).map((kind) =>
          candidates(kind).length === 0 ? null : (
            <details key={kind} className="group">
              <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-1 text-base font-semibold text-primary transition-colors [&::-webkit-details-marker]:hidden hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                {copy.addNamed(copy.kinds[kind])}
                <DisclosureCaret direction="down" className="size-4 group-open:rotate-180" />
              </summary>
              <form
                action={createEmbedSetAction}
                className="mt-3 space-y-4 rounded-inset border border-border p-4"
              >
                <input type="hidden" name="shopSlug" value={shopSlug} />
                <input type="hidden" name="kind" value={kind} />
                <Field label={copy.nameLabel}>
                  <input
                    type="text"
                    name="name"
                    placeholder={copy.namePlaceholder[kind]}
                    maxLength={80}
                    required
                    className={controlClass}
                  />
                </Field>
                <Field label={copy.membersLabel}>
                  <MemberChecklist name={`new-${kind}-member`} candidates={candidates(kind)} />
                </Field>
                <FieldActions>
                  <SubmitButton
                    className={buttonClass({ variant: "secondary" })}
                    pendingLabel={copy.saving}
                  >
                    {copy.add}
                  </SubmitButton>
                </FieldActions>
              </form>
            </details>
          ),
        )}
      </div>
    </SectionCard>
  );
}

/**
 * The members, as checkboxes in a bounded scroller. Bounded because a busy
 * shop's next month is thirty departures, and a control taller than the panel
 * it sits in pushes everything below it off the screen.
 */
function MemberChecklist({
  name,
  candidates,
  selected = [],
}: {
  name: string;
  candidates: readonly EmbedSetCandidate[];
  selected?: readonly string[];
}) {
  const chosen = new Set(selected);
  return (
    <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-border-strong bg-surface p-2">
      {candidates.map((candidate) => (
        <label
          key={candidate.id}
          className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 text-sm hover:bg-surface-sunken"
        >
          <input
            type="checkbox"
            name="memberIds"
            value={candidate.id}
            defaultChecked={chosen.has(candidate.id)}
            id={`${name}-${candidate.id}`}
            className="size-4 shrink-0"
          />
          <span className="min-w-0 truncate">{candidate.label}</span>
        </label>
      ))}
    </div>
  );
}
