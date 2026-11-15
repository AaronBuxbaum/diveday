import { StoredPhoto } from "@/components/StoredPhoto";

/** The adjacent full name labels the person; portraits are decorative, not identity proof. */
export function CrewPortrait({ person }: { person: { name: string; photoUrl?: string | null } }) {
  return person.photoUrl ? (
    <StoredPhoto
      src={person.photoUrl}
      alt=""
      className="size-8 shrink-0 rounded-full"
      sizes="32px"
    />
  ) : null;
}
