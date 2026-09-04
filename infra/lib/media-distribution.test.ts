import { readFileSync } from "node:fs";
import path from "node:path";
import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { InfraStack } from "./infra-stack";

/**
 * The media read path (AWS-8, issue #1013).
 *
 * One flat bucket holds public marketing media (`courses/`, `recap/`,
 * `dive-sites/`, `shop-logos/`) *and* imported waiver scans and payment receipts
 * (`import-waivers/`, `import-receipts/`) and physicians' evaluations recorded
 * against a medical referral (`medical-clearances/`, issue #1252) -- medical and
 * financial records read only server-side. Keys are namespaced by content type,
 * never by shop, so the only thing making one unguessable is a random suffix.
 *
 * That is why the fix is a distribution with an allowlist of behaviours rather
 * than a public bucket: what these assertions protect is not "the CDN exists"
 * but "the CDN cannot serve the scans". A future prefix added to
 * `PUBLIC_MEDIA_PREFIXES` that happens to match one of the private namespaces
 * fails here.
 */
/**
 * Built as a verified account sees it. The distribution is behind the
 * `cloudfrontVerified` context value (cdk.json), off until AWS lifts the
 * CreateDistribution gate; every assertion about what the CDN may serve is
 * about the shape it has once it exists.
 */
function template(context: Record<string, unknown> = { cloudfrontVerified: true }) {
  const app = new cdk.App({ context });
  return Template.fromStack(
    new InfraStack(app, "DiveDay", { env: { account: "123456789012", region: "us-east-1" } }),
  );
}

type DistributionConfig = {
  CacheBehaviors?: Array<{ PathPattern: string; TargetOriginId: string }>;
  DefaultCacheBehavior: { TargetOriginId: string };
  Origins: Array<{ Id: string; S3OriginConfig?: unknown; OriginAccessControlId?: unknown }>;
};

function mediaDistribution(): DistributionConfig {
  const distributions = template().findResources("AWS::CloudFront::Distribution");
  const media = Object.values(distributions).find((resource) =>
    String(
      (resource.Properties as { DistributionConfig: { Comment?: string } }).DistributionConfig
        .Comment ?? "",
    ).includes("DiveDay media"),
  );
  if (!media) throw new Error("expected a media CloudFront distribution");
  return (media.Properties as { DistributionConfig: DistributionConfig }).DistributionConfig;
}

/**
 * Every key prefix the storage layer writes, read off its source rather than
 * restated here.
 *
 * Module scope because two describes need it: the write grant must cover
 * exactly these, and the edge must account for exactly these (issue #1352).
 */
function prefixesTheAppWrites(): string[] {
  const source = readFileSync(path.join(process.cwd(), "src/lib/storage/index.ts"), "utf8");
  const found = [...source.matchAll(/keyPrefix:\s*"([^"]+)"/g)].map((match) => match[1] as string);
  // An empty read would make every assertion below vacuously true, which is the
  // one way a test that reads a file is worse than one that restates a list. A
  // refactor to a shared constant, or a rename of the property, lands here
  // rather than in a silently green suite.
  expect(found.length, "found no keyPrefix literals in src/lib/storage/index.ts").toBeGreaterThan(
    5,
  );
  return [...new Set(found)].sort();
}

describe("media distribution", () => {
  /**
   * The account cleared CloudFront's verification gate, so the committed
   * value builds the distribution. It is pinned here because the flag is the
   * one thing standing between the template and a read path: a silent revert
   * to `false` takes every course photo, recap photo, dive-site image and shop
   * logo back to the 403 of issue #1013, and no other assertion here would
   * notice -- every one of them passes its own context.
   */
  it("is on by default, as the committed value", () => {
    const committed = JSON.parse(readFileSync(path.join(process.cwd(), "cdk.json"), "utf8"));
    expect(committed.context.cloudfrontVerified).toBe(true);
  });

  it("serves exactly the six public prefixes", () => {
    const patterns = (mediaDistribution().CacheBehaviors ?? []).map((b) => b.PathPattern).sort();
    expect(patterns).toEqual([
      "arrival/*",
      "courses/*",
      "dive-sites/*",
      "recap/*",
      "shop-heroes/*",
      "shop-logos/*",
    ]);
  });

  /**
   * **The direction that was missing, and the reason two prefixes went missing
   * in it** (issue #1352).
   *
   * Everything else here asserts that the private namespaces are *absent* --
   * the property that matters most, and the one nothing may relax. But absence
   * is only half a partition: `shop-heroes` and `arrival` were in neither list,
   * so every negative assertion passed while a shop's storefront hero and a
   * diver's arrival photo were uploaded successfully and then served by
   * nothing. Not even a 403: the default behaviour is an origin on a reserved
   * TLD that can never resolve, so they landed in the black hole built for
   * `import-waivers/`, and the writer saw a save.
   *
   * So this states the whole partition against the prefixes the app actually
   * writes, read off its source: each is public or private, never both, never
   * neither. A new prefix now fails here until somebody decides which it is --
   * which is the decision worth forcing, because one answer publishes it to the
   * internet and the other makes it unreachable.
   */
  it("accounts for every prefix the app writes, as public or private and never both", () => {
    const written = prefixesTheAppWrites();
    const served = (mediaDistribution().CacheBehaviors ?? [])
      .map((b) => b.PathPattern.replace(/\/\*$/, ""))
      .sort();
    const privateNamespaces = written.filter((prefix) => !served.includes(prefix)).sort();

    // Stated as a literal so that moving a prefix from private to public is a
    // visible edit to this line rather than a silent re-derivation.
    expect(privateNamespaces).toEqual(["import-receipts", "import-waivers", "medical-clearances"]);
    expect([...served, ...privateNamespaces].sort()).toEqual(written);
    expect(served.filter((prefix) => privateNamespaces.includes(prefix))).toEqual([]);
  });

  it("has no behaviour that could reach an imported scan, a receipt, or a physician's evaluation", () => {
    const patterns = (mediaDistribution().CacheBehaviors ?? []).map((b) => b.PathPattern);
    for (const pattern of patterns) {
      expect(pattern.startsWith("import-")).toBe(false);
      // The newest private namespace, and the most sensitive: a physician's
      // evaluation of one named diver (issue #1252).
      expect(pattern.startsWith("medical-clearances")).toBe(false);
      // A catch-all in the allowlist would publish the whole bucket.
      expect(pattern).not.toBe("*");
    }
  });

  /**
   * The default behaviour is the one an unmatched path lands on, so it must not
   * be the bucket. If it were, `import-waivers/x.pdf` or a physician's evaluation
   * under `medical-clearances/` would be served by the
   * distribution the bucket policy trusts.
   */
  it("does not point its default behaviour at the media bucket", () => {
    const config = mediaDistribution();
    const bucketOriginIds = config.Origins.filter((origin) => origin.S3OriginConfig).map(
      (origin) => origin.Id,
    );
    expect(bucketOriginIds.length).toBeGreaterThan(0);
    expect(bucketOriginIds).not.toContain(config.DefaultCacheBehavior.TargetOriginId);
    for (const behavior of config.CacheBehaviors ?? []) {
      expect(bucketOriginIds).toContain(behavior.TargetOriginId);
    }
  });

  it("reaches the bucket through an origin access control, not a public bucket", () => {
    const config = mediaDistribution();
    const bucketOrigin = config.Origins.find((origin) => origin.S3OriginConfig);
    expect(bucketOrigin?.OriginAccessControlId).toBeDefined();

    const buckets = template().findResources("AWS::S3::Bucket");
    const media = Object.values(buckets).find(
      (resource) => (resource.Properties as { BucketName?: string }).BucketName === "diveday-media",
    );
    expect(
      (media?.Properties as { PublicAccessBlockConfiguration?: Record<string, boolean> })
        ?.PublicAccessBlockConfiguration,
    ).toMatchObject({
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    });
  });

  /**
   * The bucket policy is the other half of the OAC: `GetObject` is granted to
   * the distribution and to nothing else. A `Principal: "*"` here would undo
   * every assertion above.
   */
  it("grants object reads to the distribution alone", () => {
    const built = template();
    // The media bucket's own policy, found through the logical id its policy
    // names -- scanning every bucket policy in the stack would sweep in the
    // backup and visual-baseline buckets, whose posture is not this test's.
    const bucketLogicalId = Object.keys(built.findResources("AWS::S3::Bucket")).find((id) =>
      id.startsWith("MediaStorageBucket"),
    );
    expect(bucketLogicalId).toBeDefined();
    const policies = Object.values(built.findResources("AWS::S3::BucketPolicy")).filter(
      (resource) =>
        JSON.stringify((resource.Properties as { Bucket: unknown }).Bucket).includes(
          String(bucketLogicalId),
        ),
    );
    expect(policies).toHaveLength(1);
    const policy = policies[0];
    if (!policy) throw new Error("expected a media bucket policy");
    const statements = (
      policy.Properties as { PolicyDocument: { Statement: Array<Record<string, unknown>> } }
    ).PolicyDocument.Statement;
    const reads = statements.filter(
      (statement) =>
        statement.Effect === "Allow" &&
        JSON.stringify(statement.Action ?? "").includes("s3:GetObject"),
    );
    expect(reads.length).toBeGreaterThan(0);
    for (const statement of reads) {
      expect(JSON.stringify(statement.Principal)).toContain("cloudfront.amazonaws.com");
    }
    // And nothing else on this bucket may allow an anonymous read.
    for (const statement of statements) {
      if (statement.Effect !== "Allow") continue;
      expect(JSON.stringify(statement.Principal ?? "")).not.toContain('"AWS":"*"');
    }
  });

  /**
   * Until the account is verified the stack must deploy without the
   * distribution at all -- and without opening the bucket to compensate.
   * The read path is simply absent: the same 403 the deployed stack answers
   * today, documented against MEDIA_PUBLIC_URL_BASE in config/env-registry.mjs.
   */
  describe("before the account is verified", () => {
    it("leaves the distribution out", () => {
      const off = template({ cloudfrontVerified: false });
      expect(Object.keys(off.findResources("AWS::CloudFront::Distribution"))).toEqual([]);
      expect(Object.keys(off.findResources("AWS::CloudFront::OriginAccessControl"))).toEqual([]);
      expect(Object.keys(off.findOutputs("MediaDistributionDomain"))).toEqual([]);
    });

    it("still grants nobody a read of the bucket, anonymous or otherwise", () => {
      const off = template({ cloudfrontVerified: false });
      const bucketLogicalId = Object.keys(off.findResources("AWS::S3::Bucket")).find((id) =>
        id.startsWith("MediaStorageBucket"),
      );
      expect(bucketLogicalId).toBeDefined();
      const policies = Object.values(off.findResources("AWS::S3::BucketPolicy")).filter(
        (resource) =>
          JSON.stringify((resource.Properties as { Bucket: unknown }).Bucket).includes(
            String(bucketLogicalId),
          ),
      );
      for (const policy of policies) {
        const statements = (
          policy.Properties as { PolicyDocument: { Statement: Array<Record<string, unknown>> } }
        ).PolicyDocument.Statement;
        // With no distribution there is no reader to grant: the only statements
        // left are the SSL-enforcing denies.
        expect(statements.filter((statement) => statement.Effect === "Allow")).toEqual([]);
      }
    });

    it("points the app at the bucket endpoint, the documented 403, rather than at nothing", () => {
      const off = template({ cloudfrontVerified: false });
      const secret = JSON.stringify(off.findResources("AWS::SecretsManager::Secret"));
      expect(secret).toContain("MEDIA_PUBLIC_URL_BASE=https://");
      expect(secret).toContain(".s3.");
      expect(secret).not.toContain("MediaDistribution");
    });
  });
});

/**
 * **The one credential that may read a private object back, and the one prefix
 * it may read** (issue #1283).
 *
 * The assertions above prove the CDN cannot serve a physician's evaluation.
 * This proves the other half: the app itself *can* fetch one, and can fetch
 * nothing else -- because #1252 shipped the upload with no read grant at all,
 * so a shop stored the most sensitive document the product holds and could
 * never open it.
 *
 * The failure this guards against is a widening: somebody needing a read path
 * for some other prefix and reaching for the statement that already exists.
 * A `GetObject` on `arnForObjects("*")` would let one bug in a URL column turn
 * this credential into a reader of every imported waiver scan and payment
 * receipt in the bucket.
 */
describe("the media uploader credential", () => {
  type Statement = { Sid?: string; Action: string | string[]; Resource: unknown };
  type Policy = {
    Properties?: { PolicyDocument?: { Statement?: Statement[] }; Users?: unknown[] };
  };

  /**
   * **The media uploader's own statements, and nobody else's.**
   *
   * Flattening every `AWS::IAM::Policy` in the stack was the first version of
   * this and it proved less than its name: `some statement mentions the
   * prefix` is satisfied by an unrelated principal, and a *second* GetObject on
   * this user scoped to `arnForObjects("*")` would pass while being exactly the
   * widening these cases exist to catch. So the policy is resolved by the user
   * it is attached to, and the assertion is over *every* read it grants.
   */
  function uploaderStatements(): Statement[] {
    const t = template();
    const user = Object.keys(t.findResources("AWS::IAM::User")).find((id) =>
      id.startsWith("MediaUploaderUser"),
    );
    expect(user, "MediaUploaderUser is not in the stack").toBeDefined();
    const policies = Object.values(t.findResources("AWS::IAM::Policy")) as Policy[];
    const mine = policies.filter((policy) =>
      JSON.stringify(policy.Properties?.Users ?? []).includes(user as string),
    );
    expect(mine.length, "no policy is attached to MediaUploaderUser").toBeGreaterThan(0);
    return mine.flatMap((policy) => policy.Properties?.PolicyDocument?.Statement ?? []);
  }

  it("may read objects under medical-clearances/ and nowhere else", () => {
    const reads = uploaderStatements().filter((statement) =>
      [statement.Action].flat().includes("s3:GetObject"),
    );
    // It has one, because without it the upload buys retention liability with
    // no retrieval value -- a shop stores the most sensitive document the
    // product holds and can never open it (issue #1283).
    expect(reads).toHaveLength(1);
    expect(reads[0]?.Sid).toBe("ReadMedicalClearancesOnly");
    // *Every* read this credential grants is scoped to that prefix. The
    // resource is a CloudFormation join around the bucket ARN; the prefix is
    // the literal that matters.
    for (const read of reads) {
      expect(JSON.stringify(read.Resource)).toContain("/medical-clearances/*");
    }
  });

  it("never grants read across the whole media bucket", () => {
    // The widening this exists to catch, stated as the thing that must not be
    // true rather than as a property of one named statement: a GetObject whose
    // resource ends at `/*` on the bucket root would cover import-waivers/ and
    // import-receipts/ as well, which nothing in the app has any business
    // fetching back.
    for (const statement of uploaderStatements()) {
      if (![statement.Action].flat().includes("s3:GetObject")) continue;
      const resource = JSON.stringify(statement.Resource);
      expect(resource).not.toMatch(/"\/\*"/);
    }
  });
});

/**
 * **The write grant names the prefixes the app writes, and no more** (issue
 * #1349).
 *
 * `deleteS3Image` now refuses a key whose signed path is not the object it
 * names, and this is the wall behind that check rather than a restatement of
 * it: the credential holds `DeleteObject`, the caller's key is the only thing
 * deciding *which* object, and the grant used to be `arnForObjects("*")` -- so
 * a key that escaped its namespace was a delete anywhere in the bucket.
 *
 * The list is read out of `src/lib/storage/index.ts` rather than restated here,
 * because a short list fails *silently*: `s3ImageStorageProvider.upload`
 * returns `{ status: "failed" }` on a non-ok response instead of throwing, so
 * the tenth prefix somebody adds next year would surface as a shop's upload not
 * sticking, with nothing in the logs naming IAM. The issue that asked for this
 * listed seven of the nine, which is the mistake this reads a file to avoid.
 */
describe("the media uploader's write grant", () => {
  type Statement = { Sid?: string; Action: string | string[]; Resource: unknown };

  function writeStatement(): Statement {
    const t = template();
    const user = Object.keys(t.findResources("AWS::IAM::User")).find((id) =>
      id.startsWith("MediaUploaderUser"),
    );
    const policies = Object.values(t.findResources("AWS::IAM::Policy")) as {
      Properties?: { PolicyDocument?: { Statement?: Statement[] }; Users?: unknown[] };
    }[];
    const statements = policies
      .filter((policy) => JSON.stringify(policy.Properties?.Users ?? []).includes(user as string))
      .flatMap((policy) => policy.Properties?.PolicyDocument?.Statement ?? []);
    const write = statements.find((statement) =>
      [statement.Action].flat().includes("s3:DeleteObject"),
    );
    expect(write, "no DeleteObject statement on MediaUploaderUser").toBeDefined();
    return write as Statement;
  }

  /** The literal tail of a CloudFormation `Fn::Join` around the bucket ARN. */
  function grantedKeyPattern(resource: unknown): string {
    const join = (resource as { "Fn::Join"?: [string, unknown[]] })?.["Fn::Join"];
    const tail = (join?.[1] ?? [])
      .filter((part): part is string => typeof part === "string")
      .join("");
    return tail.replace(/^\//, "");
  }

  /** Every `keyPrefix` the storage layer writes under, read off the source. */
  it("grants write on exactly the prefixes the storage layer writes", () => {
    const granted = [
      ...new Set([writeStatement().Resource].flat().map((resource) => grantedKeyPattern(resource))),
    ]
      .map((pattern) => pattern.replace(/\/\*$/, ""))
      .sort();
    expect(granted).toEqual(prefixesTheAppWrites());
  });

  it("never grants write across the whole media bucket", () => {
    // Stated as the thing that must not be true rather than as a property of
    // the named statement, so a second, wider write statement added later is
    // caught too. A resource ending at `/*` on the bucket root is the shape
    // that made an escaped key a delete anywhere.
    const resource = JSON.stringify(writeStatement().Resource);
    expect(resource).not.toMatch(/"\/\*"/);
  });
});
