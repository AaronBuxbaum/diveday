const PUBLICATION_ID = /^([1-9][0-9]{0,19})-([1-9][0-9]{0,5})$/u;

export function isPublicationId(value) {
  return typeof value === "string" && PUBLICATION_ID.test(value);
}

export function publicationIdFromEnv(env = process.env) {
  const runId = env.GITHUB_RUN_ID;
  const attempt = env.GITHUB_RUN_ATTEMPT;
  if (typeof runId !== "string" || typeof attempt !== "string") {
    throw new Error("GITHUB_RUN_ID and GITHUB_RUN_ATTEMPT are required for visual publication");
  }
  const value = `${runId}-${attempt}`;
  if (!isPublicationId(value)) throw new Error("invalid visual publication identity");
  return value;
}

/** Older markers without a valid identity sort before every current run. */
export function comparePublicationIds(left, right) {
  const leftMatch = typeof left === "string" ? PUBLICATION_ID.exec(left) : null;
  const rightMatch = typeof right === "string" ? PUBLICATION_ID.exec(right) : null;
  if (!leftMatch) return rightMatch ? -1 : 0;
  if (!rightMatch) return 1;

  for (let index = 1; index <= 2; index += 1) {
    const leftPart = BigInt(leftMatch[index]);
    const rightPart = BigInt(rightMatch[index]);
    if (leftPart < rightPart) return -1;
    if (leftPart > rightPart) return 1;
  }
  return 0;
}
