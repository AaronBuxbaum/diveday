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

  it("serves exactly the four public prefixes", () => {
    const patterns = (mediaDistribution().CacheBehaviors ?? []).map((b) => b.PathPattern).sort();
    expect(patterns).toEqual(["courses/*", "dive-sites/*", "recap/*", "shop-logos/*"]);
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
