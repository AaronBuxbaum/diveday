/**
 * What a rolled-back create of this stack leaves behind, read off its
 * synthesized template.
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
export function resolveTemplateValue(value, { account, region }) {
  if (typeof value === "string") return value;
  if (value?.Ref === "AWS::AccountId") return account ?? null;
  if (value?.Ref === "AWS::Region") return region ?? null;
  const join = value?.["Fn::Join"];
  if (!Array.isArray(join) || join.length !== 2 || !Array.isArray(join[1])) return null;
  const separator = typeof join[0] === "string" ? join[0] : null;
  if (separator === null) return null;
  const parts = join[1].map((part) => resolveTemplateValue(part, { account, region }));
  return parts.some((part) => part === null) ? null : parts.join(separator);
}

/**
 * Everything a create that rolled back can leave holding a name the next create
 * needs, split by what it takes to remove each kind.
 *
 * Two sources, and they are different problems with one answer:
 *
 * - **Every log group**, whatever its deletion policy. Their names are fixed,
 *   and the Lambda service recreates `/aws/lambda/<function>` when a
 *   custom-resource provider is invoked to handle its own Delete during the
 *   rollback -- after CloudFormation has deleted the group, so nothing owns
 *   what is left behind.
 * - **Every resource the template marks `Retain`**, which CloudFormation keeps
 *   on purpose when a create rolls back. Three buckets and a secret today, and
 *   each one blocks the next create in turn: the secret first, then a bucket,
 *   then the next bucket, one failed deploy each.
 *
 * `unresolved` and `unsupportedRetained` come back rather than being dropped. A
 * retained type this does not know how to remove is a deploy that will fail on
 * a name nothing cleaned, and the operator should hear it from here rather than
 * from CloudFormation ten minutes later.
 */
export function orphansFrom(template, { account, region }) {
  const logGroups = [];
  const buckets = [];
  const secrets = [];
  const unresolved = [];
  const unsupportedRetained = [];

  const resolve = (value) => {
    const name = resolveTemplateValue(value, { account, region });
    if (name === null) unresolved.push(value);
    return name;
  };

  for (const [id, resource] of Object.entries(template?.Resources ?? {})) {
    const properties = resource?.Properties ?? {};
    if (resource?.Type === "AWS::Logs::LogGroup") {
      if (properties.LogGroupName !== undefined) {
        const name = resolve(properties.LogGroupName);
        if (name !== null) logGroups.push(name);
      }
      continue;
    }
    if (resource?.DeletionPolicy !== "Retain") continue;
    if (resource.Type === "AWS::S3::Bucket") {
      const name = resolve(properties.BucketName);
      if (name !== null) buckets.push(name);
    } else if (resource.Type === "AWS::SecretsManager::Secret") {
      const name = resolve(properties.Name);
      if (name !== null) secrets.push(name);
    } else {
      unsupportedRetained.push({ id, type: resource.Type });
    }
  }

  return { logGroups, buckets, secrets, unresolved, unsupportedRetained };
}
