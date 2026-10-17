import { StatusMark } from "@/components/ui/StatusMark";

/** The one line a decompression departure carries: check the cards DiveDay cannot hold. */
export function DecompressionReminder({ text }: { text: string }) {
  return (
    <p className="mt-3 flex gap-2 rounded-lg bg-warning-tint px-3 py-2 text-base text-warning-strong">
      <StatusMark variant="warning" size="md" />
      <span>{text}</span>
    </p>
  );
}
