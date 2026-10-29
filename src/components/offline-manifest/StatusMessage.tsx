/**
 * Preserve line boundaries in multi-record offline notices while keeping
 * their surrounding live status region.
 */
export function StatusMessage({ message }: { message: string }) {
  const lines = message.split("\n");
  const occurrences = new Map<string, number>();
  return lines.map((line, index) => {
    const occurrence = occurrences.get(line) ?? 0;
    occurrences.set(line, occurrence + 1);
    return (
      <span key={`${line}:${occurrence}`}>
        {index > 0 ? <br /> : null}
        {line}
      </span>
    );
  });
}
