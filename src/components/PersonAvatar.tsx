import { StoredPhoto } from "@/components/StoredPhoto";

const SIZES = {
  sm: { box: "size-8 text-xs", px: "32px" },
  md: { box: "size-10 text-sm", px: "40px" },
  lg: { box: "size-16 text-xl", px: "64px" },
} as const;

/** "Dana Reyes" → "DR"; one name → its first letter; nothing → "". */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const first = [...(words[0] ?? "")][0] ?? "";
  const last = words.length > 1 ? ([...(words[words.length - 1] ?? "")][0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

/**
 * A person's picture, or their initials when there is none. Decorative: the
 * name always sits beside it, so it carries no alt text. Round, quiet, and
 * ink-light on paper (outline, no fill).
 */
export function PersonAvatar({
  name,
  photoPath,
  size = "md",
  className = "",
}: {
  name: string;
  photoPath?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const { box, px } = SIZES[size];
  if (photoPath) {
    return (
      <StoredPhoto
        src={photoPath}
        alt=""
        sizes={px}
        className={`${box} shrink-0 rounded-full border border-border ${className}`}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`inline-flex ${box} shrink-0 items-center justify-center rounded-full border border-border bg-surface-sunken font-medium text-muted ${className}`}
    >
      {initialsOf(name)}
    </span>
  );
}
