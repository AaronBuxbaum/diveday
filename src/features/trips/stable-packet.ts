/** Discard every composed section when any identity row changed during its reads. */
export async function stablePacket<I, T>(
  read: () => Promise<I | null>,
  compose: (identity: I) => Promise<T>,
): Promise<{ status: "stable"; packet: T } | { status: "missing" | "changed" }> {
  let seen = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    const before = await read();
    if (!before) return { status: seen ? "changed" : "missing" };
    seen = true;
    let packet: T;
    try {
      packet = await compose(before);
    } catch (error) {
      const afterFailure = await read();
      if (!afterFailure || JSON.stringify(before) !== JSON.stringify(afterFailure)) continue;
      throw error;
    }
    const after = await read();
    if (after && JSON.stringify(before) === JSON.stringify(after))
      return { status: "stable", packet };
  }
  return { status: "changed" };
}
