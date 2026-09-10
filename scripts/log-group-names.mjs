/**
 * Which log groups a synthesized CloudFormation template declares, by name.
 *
 * Its one caller is `scripts/migrate-region.mjs`, which deletes them when a
 * create has rolled back and left them orphaned. It is a module of its own so
 * that the two things that have gone wrong here can be tested without
 * synthesizing a stack:
 *
 * 1. The template lives at `<construct id>.template.json`, not
 *    `<stack name>.template.json`. Reading the wrong one threw, the caller's
 *    catch reported "could not synthesize", and the sweep skipped itself while
 *    claiming to have run.
 * 2. Two of the names are `Fn::Join`s over the account id rather than string
 *    literals, so a `typeof name === "string"` filter drops them -- silently,
 *    and they are the two nothing else would catch, because they carry the
 *    word `sns` rather than `diveday`.
 */

/**
 * The cloud assembly names each template after the stack's **construct id**
 * (`DiveDay`), never its `stackName` (`diveday-infra`). Verified against a real
 * `cdk synth`, and pinned by a test, because the two are easy to confuse and
 * getting it wrong fails in the quietest possible way.
 */
export function templateFileNameFor(stackId) {
  return `${stackId}.template.json`;
}

/**
 * Resolve one `LogGroupName` property to the string CloudFormation would.
 *
 * Handles the two shapes this stack actually produces -- a literal, and an
 * `Fn::Join` over literals and `Ref`s to the account or region. Anything else
 * returns `null`, which the caller reports rather than drops: a name it cannot
 * work out is a log group the deploy may still trip over, and the operator
 * needs to hear about it.
 */
export function resolveLogGroupName(value, { account, region }) {
  if (typeof value === "string") return value;
  if (value?.Ref === "AWS::AccountId") return account ?? null;
  if (value?.Ref === "AWS::Region") return region ?? null;
  const join = value?.["Fn::Join"];
  if (!Array.isArray(join) || join.length !== 2 || !Array.isArray(join[1])) return null;
  const separator = typeof join[0] === "string" ? join[0] : null;
  if (separator === null) return null;
  const parts = join[1].map((part) => resolveLogGroupName(part, { account, region }));
  return parts.some((part) => part === null) ? null : parts.join(separator);
}

/**
 * Every log group name in a template, plus the ones that could not be resolved.
 *
 * Returns both halves rather than filtering, so the caller can say what it is
 * about to miss instead of quietly missing it.
 */
export function logGroupNamesFrom(template, { account, region }) {
  const declared = Object.values(template?.Resources ?? {})
    .filter((resource) => resource?.Type === "AWS::Logs::LogGroup")
    .map((resource) => resource?.Properties?.LogGroupName)
    .filter((value) => value !== undefined);

  const names = [];
  const unresolved = [];
  for (const value of declared) {
    const name = resolveLogGroupName(value, { account, region });
    if (name === null) unresolved.push(value);
    else names.push(name);
  }
  return { names, unresolved };
}
