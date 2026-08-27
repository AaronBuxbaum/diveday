import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { InfraStack } from "./infra-stack";

/**
 * The media read path (AWS-8, issue #1013).
 *
 * One flat bucket holds public marketing media (`courses/`, `recap/`,
 * `dive-sites/`, `shop-logos/`) *and* imported waiver scans and payment receipts
 * (`import-waivers/`, `import-receipts/`) -- medical and financial records read
 * only server-side by the export bundler. Keys are namespaced by content type,
 * never by shop, so the only thing making one unguessable is a random suffix.
 *
 * That is why the fix is a distribution with an allowlist of behaviours rather
 * than a public bucket: what these assertions protect is not "the CDN exists"
 * but "the CDN cannot serve the scans". A future prefix added to
 * `PUBLIC_MEDIA_PREFIXES` that happens to match `import-*` fails here.
 */
function template() {
  const app = new cdk.App();
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
  it("serves exactly the four public prefixes", () => {
    const patterns = (mediaDistribution().CacheBehaviors ?? []).map((b) => b.PathPattern).sort();
    expect(patterns).toEqual(["courses/*", "dive-sites/*", "recap/*", "shop-logos/*"]);
  });

  it("has no behaviour that could reach an imported scan or receipt", () => {
    const patterns = (mediaDistribution().CacheBehaviors ?? []).map((b) => b.PathPattern);
    for (const pattern of patterns) {
      expect(pattern.startsWith("import-")).toBe(false);
      // A catch-all in the allowlist would publish the whole bucket.
      expect(pattern).not.toBe("*");
    }
  });

  /**
   * The default behaviour is the one an unmatched path lands on, so it must not
   * be the bucket. If it were, `import-waivers/x.pdf` would be served by the
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
});
