import { describe, expect, it } from "vitest";
import { readCloudWatchLogsConfig } from "./cloudwatch-config";

const complete = {
  CLOUDWATCH_AWS_REGION: "us-east-1",
  CLOUDWATCH_LOG_GROUP: "/diveday/app",
  CLOUDWATCH_AWS_ACCESS_KEY_ID: "AKIAEXAMPLE",
  CLOUDWATCH_AWS_SECRET_ACCESS_KEY: "secret",
} as const satisfies Readonly<Record<string, string | undefined>>;

describe("readCloudWatchLogsConfig", () => {
  it("reads a complete set", () => {
    expect(readCloudWatchLogsConfig({ ...complete, VERCEL_ENV: "production" })).toEqual({
      region: "us-east-1",
      logGroupName: "/diveday/app",
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "secret",
      environment: "production",
    });
  });

  it("is unconfigured when nothing is set", () => {
    expect(readCloudWatchLogsConfig({})).toBeNull();
  });

  it.each(Object.keys(complete))("is unconfigured when %s alone is missing", (missing) => {
    const partial = { ...complete, [missing]: undefined };
    expect(readCloudWatchLogsConfig(partial)).toBeNull();
  });

  it("treats a blank value as unset rather than shipping to an empty group name", () => {
    expect(readCloudWatchLogsConfig({ ...complete, CLOUDWATCH_LOG_GROUP: "   " })).toBeNull();
  });

  it("refuses to configure under the e2e fleet's external-HTTP block", () => {
    expect(
      readCloudWatchLogsConfig({ ...complete, DIVEDAY_DISABLE_EXTERNAL_HTTP: "1" }),
    ).toBeNull();
  });

  it("falls back to NODE_ENV, then to development, for the stream's environment label", () => {
    expect(readCloudWatchLogsConfig({ ...complete, NODE_ENV: "test" })?.environment).toBe("test");
    expect(readCloudWatchLogsConfig({ ...complete, NODE_ENV: undefined })?.environment).toBe(
      "development",
    );
  });
});
