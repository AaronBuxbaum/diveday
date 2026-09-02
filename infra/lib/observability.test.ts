import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { InfraStack } from "./infra-stack";
import {
  alarmNameFor,
  filterPatternFor,
  LOG_SIGNALS,
  METRIC_NAMESPACE,
  MUTATION_DURATION_SIGNAL,
  mutationDurationFilterPattern,
  queryConstructIdFor,
  SAVED_LOG_QUERIES,
  SES_REPUTATION_SIGNALS,
  sesReputationAlarmNameFor,
  WEB_VITAL_SIGNALS,
  webVitalAlarmNameFor,
  webVitalFilterPatternFor,
} from "./observability";

/**
 * The registry in `observability.ts` is only as good as its weakest claim: a
 * metric filter whose pattern matches nothing does not fail, error, or warn --
 * it counts zero, forever, and the alarm above it reads healthy. Everything
 * here exists to make that specific silence impossible.
 */

function synthesize() {
  const app = new cdk.App();
  const stack = new InfraStack(app, "DiveDayObservability", {
    env: { account: "123456789012", region: "us-east-1" },
  });
  return Template.fromStack(stack);
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const found = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(full);
      return entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") ? [full] : [];
    }),
  );
  return found.flat();
}

/** Every event code `log()` is actually called with, read off the app source. */
async function emittedEventCodes(): Promise<Set<string>> {
  const files = await sourceFiles(path.join(process.cwd(), "src"));
  const contents = await Promise.all(files.map((file) => readFile(file, "utf8")));
  const codes = new Set<string>();
  for (const source of contents) {
    for (const match of source.matchAll(/\blog\(\s*"([a-z0-9_.]+)"/g)) {
      codes.add(match[1] as string);
    }
  }
  return codes;
}

describe("the log-signal registry", () => {
  it("gives every signal exactly one way to match", () => {
    for (const signal of LOG_SIGNALS) {
      const hasEvents = (signal.events?.length ?? 0) > 0;
      expect(hasEvents !== Boolean(signal.level)).toBe(true);
    }
  });

  it("names each metric and configured alarm once", () => {
    expect(new Set(LOG_SIGNALS.map((signal) => signal.metricName)).size).toBe(LOG_SIGNALS.length);
    const alarmed = LOG_SIGNALS.filter((signal) => signal.alarm !== false);
    expect(new Set(alarmed.map(alarmNameFor)).size).toBe(alarmed.length);
  });

  it("sets a threshold that can be reached and a period CloudWatch accepts", () => {
    for (const signal of LOG_SIGNALS) {
      expect(signal.threshold).toBeGreaterThan(0);
      expect(signal.periodMinutes).toBeGreaterThan(0);
      // CloudWatch's own ceiling for an alarm period is one day.
      expect(signal.periodMinutes).toBeLessThanOrEqual(1_440);
    }
  });

  it("says what to do about every alarm it raises", () => {
    for (const signal of LOG_SIGNALS) {
      expect(signal.response.length).toBeGreaterThan(20);
      expect(signal.why.length).toBeGreaterThan(20);
    }
  });

  it("only counts event codes the app still emits", async () => {
    const emitted = await emittedEventCodes();
    // Guards the guard: a regex that matched nothing would pass every assertion
    // below by vacuous truth.
    expect(emitted.size).toBeGreaterThan(20);

    const referenced = LOG_SIGNALS.flatMap((signal) => signal.events ?? []);
    expect(referenced.length).toBeGreaterThan(0);
    expect(referenced.filter((code) => !emitted.has(code))).toEqual([]);
  });

  it("builds a CloudWatch JSON filter pattern for both signal shapes", () => {
    expect(filterPatternFor({ ...LOG_SIGNALS[0], level: "error", events: undefined })).toBe(
      '{ $.level = "error" }',
    );
    expect(filterPatternFor({ ...LOG_SIGNALS[0], level: undefined, events: ["a.b", "c.d"] })).toBe(
      '{ $.event = "a.b" || $.event = "c.d" }',
    );
  });

  it("renders an alarm name a human can read in a subject line", () => {
    expect(alarmNameFor({ ...LOG_SIGNALS[0], metricName: "MoneyPathRefusals" })).toBe(
      "diveday-money-path-refusals",
    );
  });

  it("gives every saved query a unique construct id and a stated purpose", () => {
    expect(new Set(SAVED_LOG_QUERIES.map(queryConstructIdFor)).size).toBe(SAVED_LOG_QUERIES.length);
    for (const query of SAVED_LOG_QUERIES) {
      expect(query.name.startsWith("DiveDay/")).toBe(true);
      expect(query.why.length).toBeGreaterThan(20);
      expect(queryConstructIdFor(query)).toMatch(/^[A-Za-z0-9]+$/);
    }
  });

  it("keeps the mutation metric tied to the client event and field", () => {
    expect(mutationDurationFilterPattern()).toBe(
      '{ $.event = "mutation_duration.reported" && $.durationMs = * }',
    );
    expect(MUTATION_DURATION_SIGNAL.metricName).toBe("MutationDuration");
  });
});

describe("the synthesized observability stack", () => {
  it("bounds retention on the app log group rather than keeping the record forever", () => {
    const groups = synthesize().findResources("AWS::Logs::LogGroup") as Record<
      string,
      { Properties?: { LogGroupName?: string; RetentionInDays?: number } }
    >;
    const appGroup = Object.values(groups).find(
      (group) => group.Properties?.LogGroupName === "/diveday/app",
    );
    expect(appGroup?.Properties?.RetentionInDays).toBe(30);
  });

  it("lets the shipper append to that one group and read nothing back", () => {
    const policies = Object.values(
      synthesize().findResources("AWS::IAM::Policy") as Record<
        string,
        {
          Properties?: {
            PolicyDocument?: { Statement?: { Action?: unknown; Resource?: unknown }[] };
            Users?: unknown[];
          };
        }
      >,
    );
    // Matched by the identity the policy is attached to, not by the actions in
    // it: S10's SNS delivery-status role also holds `logs:PutLogEvents`, and a
    // filter on the action list would either pick that up or be written to
    // match only what this test already expects to find.
    const shipperStatements = policies
      .filter((policy) =>
        JSON.stringify(policy.Properties?.Users ?? []).includes("CloudWatchLogShipperUser"),
      )
      .flatMap((policy) => policy.Properties?.PolicyDocument?.Statement ?? []);

    expect(shipperStatements).toHaveLength(1);
    expect(shipperStatements[0]?.Action).toEqual(["logs:CreateLogStream", "logs:PutLogEvents"]);
    // Nothing that could create an unexpiring group, delete a stream, or read
    // the app's own operational record back out of AWS.
    const rendered = JSON.stringify(shipperStatements[0]);
    for (const forbidden of [
      "logs:CreateLogGroup",
      "logs:DeleteLogGroup",
      "logs:GetLogEvents",
      "logs:FilterLogEvents",
      "logs:DescribeLogGroups",
    ]) {
      expect(rendered).not.toContain(forbidden);
    }
    expect(rendered).not.toContain('"*"');
  });

  it("expands every registry row into a filter, alarming only configured rows", () => {
    const template = synthesize();
    const filters = Object.values(
      template.findResources("AWS::Logs::MetricFilter") as Record<
        string,
        {
          Properties?: {
            FilterPattern?: string;
            MetricTransformations?: {
              MetricName?: string;
              MetricNamespace?: string;
              MetricValue?: string;
            }[];
          };
        }
      >,
    );
    const alarms = Object.values(
      template.findResources("AWS::CloudWatch::Alarm") as Record<
        string,
        {
          Properties?: {
            AlarmName?: string;
            Threshold?: number;
            Period?: number;
            TreatMissingData?: string;
            AlarmActions?: unknown[];
            AlarmDescription?: string;
          };
        }
      >,
    );

    // Count signals plus web-vital signals; only the three Core Web Vitals
    // among the latter carry an alarm.
    expect(filters).toHaveLength(LOG_SIGNALS.length + WEB_VITAL_SIGNALS.length + 1);
    expect(alarms).toHaveLength(
      LOG_SIGNALS.filter((signal) => signal.alarm !== false).length +
        WEB_VITAL_SIGNALS.filter((signal) => signal.alarm).length +
        SES_REPUTATION_SIGNALS.length,
    );

    for (const signal of LOG_SIGNALS) {
      const filter = filters.find((candidate) =>
        candidate.Properties?.MetricTransformations?.some(
          (transformation) => transformation.MetricName === signal.metricName,
        ),
      );
      expect(filter?.Properties?.FilterPattern).toBe(filterPatternFor(signal));
      expect(filter?.Properties?.MetricTransformations?.[0]?.MetricNamespace).toBe(
        METRIC_NAMESPACE,
      );

      const alarm = alarms.find(
        (candidate) => candidate.Properties?.AlarmName === alarmNameFor(signal),
      );
      if (signal.alarm === false) {
        expect(alarm).toBeUndefined();
        continue;
      }
      expect(alarm?.Properties?.Threshold).toBe(signal.threshold);
      expect(alarm?.Properties?.Period).toBe(signal.periodMinutes * 60);
      // An idle app must never page. Missing data here means "nothing was
      // logged", not "the app is on fire".
      expect(alarm?.Properties?.TreatMissingData).toBe("notBreaching");
      // An alarm with no action is a coloured square on a page nobody has open.
      expect(alarm?.Properties?.AlarmActions).toHaveLength(1);
      expect(alarm?.Properties?.AlarmDescription).toContain(signal.response);
    }

    const mutationFilter = filters.find((candidate) =>
      candidate.Properties?.MetricTransformations?.some(
        (transformation) => transformation.MetricName === MUTATION_DURATION_SIGNAL.metricName,
      ),
    );
    expect(mutationFilter?.Properties?.FilterPattern).toBe(mutationDurationFilterPattern());
    expect(mutationFilter?.Properties?.MetricTransformations?.[0]?.MetricValue).toBe(
      "$.durationMs",
    );
    expect(JSON.stringify(mutationFilter)).toContain('"Key":"Action"');
    expect(JSON.stringify(mutationFilter)).toContain('"Value":"$.action"');
  });

  it("alarms on SES's own bounce and complaint rates at AWS's review line", () => {
    const template = synthesize();
    const alarms = Object.values(
      template.findResources("AWS::CloudWatch::Alarm") as Record<
        string,
        {
          Properties?: {
            AlarmName?: string;
            Namespace?: string;
            MetricName?: string;
            Statistic?: string;
            Threshold?: number;
            Period?: number;
            TreatMissingData?: string;
            AlarmActions?: unknown[];
            AlarmDescription?: string;
            Dimensions?: unknown[];
          };
        }
      >,
    );
    expect(SES_REPUTATION_SIGNALS.map((signal) => signal.metricName)).toEqual([
      "Reputation.BounceRate",
      "Reputation.ComplaintRate",
    ]);
    for (const signal of SES_REPUTATION_SIGNALS) {
      const alarm = alarms.find(
        (candidate) => candidate.Properties?.AlarmName === sesReputationAlarmNameFor(signal),
      );
      // AWS's own metric, account-wide: no dimensions, no filter of ours.
      expect(alarm?.Properties?.Namespace).toBe("AWS/SES");
      expect(alarm?.Properties?.MetricName).toBe(signal.metricName);
      expect(alarm?.Properties?.Dimensions).toBeUndefined();
      expect(alarm?.Properties?.Statistic).toBe("Average");
      expect(alarm?.Properties?.Period).toBe(3600);
      expect(alarm?.Properties?.Threshold).toBe(signal.threshold);
      // The review thresholds AWS publishes, as fractions: 5% bounces, 0.1% complaints.
      expect(signal.threshold).toBeLessThanOrEqual(
        signal.metricName === "Reputation.BounceRate" ? 0.05 : 0.001,
      );
      expect(alarm?.Properties?.TreatMissingData).toBe("notBreaching");
      expect(alarm?.Properties?.AlarmActions).toHaveLength(1);
      expect(alarm?.Properties?.AlarmDescription).toContain(signal.response);
    }
  });

  it("extracts each Core Web Vital as a value, scored at p75", () => {
    const template = synthesize();
    const filters = Object.values(
      template.findResources("AWS::Logs::MetricFilter") as Record<
        string,
        {
          Properties?: {
            FilterPattern?: string;
            MetricTransformations?: {
              MetricName?: string;
              MetricValue?: string;
              DefaultValue?: number;
            }[];
          };
        }
      >,
    );
    const alarms = Object.values(
      template.findResources("AWS::CloudWatch::Alarm") as Record<
        string,
        {
          Properties?: {
            AlarmName?: string;
            Threshold?: number;
            ExtendedStatistic?: string;
            ComparisonOperator?: string;
            EvaluationPeriods?: number;
          };
        }
      >,
    );

    for (const signal of WEB_VITAL_SIGNALS) {
      const transformation = filters
        .flatMap((filter) => filter.Properties?.MetricTransformations ?? [])
        .find((candidate) => candidate.MetricName === signal.metricName);
      // The measurement itself, not a count of reports.
      expect(transformation?.MetricValue).toBe(`$.${signal.field}`);
      // A page view that reported no INP did not score zero on it; publishing a
      // 0 would drag the percentile down until the metric flattered the app.
      expect(transformation?.DefaultValue).toBeUndefined();
      expect(
        filters.find((filter) =>
          filter.Properties?.MetricTransformations?.some(
            (candidate) => candidate.MetricName === signal.metricName,
          ),
        )?.Properties?.FilterPattern,
      ).toBe(webVitalFilterPatternFor(signal));

      const alarm = alarms.find(
        (candidate) => candidate.Properties?.AlarmName === webVitalAlarmNameFor(signal),
      );
      if (!signal.alarm) {
        // Collected and graphed for context, never paged on.
        expect(alarm).toBeUndefined();
        continue;
      }
      expect(alarm?.Properties?.ExtendedStatistic).toBe("p75");
      expect(alarm?.Properties?.Threshold).toBe(signal.goodThreshold);
      expect(alarm?.Properties?.ComparisonOperator).toBe("GreaterThanThreshold");
      // One slow hour is a visitor on hotel wifi; three is a regression.
      expect(alarm?.Properties?.EvaluationPeriods).toBe(3);
    }
  });

  it("reads the same vital field names the app writes", async () => {
    const source = await readFile(
      path.join(process.cwd(), "src/lib/observability/web-vitals.ts"),
      "utf8",
    );
    const declared = [...source.matchAll(/field:\s*"([a-z]+)"/g)].map((match) => match[1]);
    expect(declared.length).toBe(WEB_VITAL_SIGNALS.length);
    // A metric filter naming a field the log line does not carry extracts
    // nothing, forever, without erroring -- the whole reason this guard exists.
    expect(WEB_VITAL_SIGNALS.map((signal) => signal.field).sort()).toEqual([...declared].sort());
  });

  it("scopes the RUM guest credential to one action on one app monitor", () => {
    const template = synthesize();
    const pools = Object.values(
      template.findResources("AWS::Cognito::IdentityPool") as Record<
        string,
        { Properties?: { AllowUnauthenticatedIdentities?: boolean } }
      >,
    );
    expect(pools).toHaveLength(1);
    // The point of the pool: an anonymous visitor gets a credential.
    expect(pools[0]?.Properties?.AllowUnauthenticatedIdentities).toBe(true);

    const guestRole = Object.values(
      template.findResources("AWS::IAM::Role") as Record<
        string,
        { Properties?: { RoleName?: string; AssumeRolePolicyDocument?: unknown } }
      >,
    ).find((role) => role.Properties?.RoleName === "diveday-rum-guest");
    const trust = JSON.stringify(guestRole?.Properties?.AssumeRolePolicyDocument);
    // Both conditions are load-bearing: the role ARN ships in the browser
    // bundle, so it must be unassumable through anyone else's identity pool and
    // never reachable as an authenticated identity's role.
    expect(trust).toContain("cognito-identity.amazonaws.com:aud");
    expect(trust).toContain("unauthenticated");

    const rumStatements = Object.values(
      template.findResources("AWS::IAM::Policy") as Record<
        string,
        {
          Properties?: {
            PolicyDocument?: { Statement?: { Action?: unknown; Resource?: unknown }[] };
            Roles?: unknown[];
          };
        }
      >,
    )
      .filter((policy) => JSON.stringify(policy.Properties?.Roles ?? []).includes("RumGuestRole"))
      .flatMap((policy) => policy.Properties?.PolicyDocument?.Statement ?? []);

    expect(rumStatements).toHaveLength(1);
    expect(rumStatements[0]?.Action).toBe("rum:PutRumEvents");
    expect(JSON.stringify(rumStatements[0]?.Resource)).not.toContain('"*"');
  });

  it("keeps RUM to performance telemetry, cookie-free, on the app's own origin", () => {
    const monitors = Object.values(
      synthesize().findResources("AWS::RUM::AppMonitor") as Record<
        string,
        {
          Properties?: {
            Domain?: string;
            CwLogEnabled?: boolean;
            AppMonitorConfiguration?: {
              Telemetries?: string[];
              AllowCookies?: boolean;
              EnableXRay?: boolean;
            };
          };
        }
      >,
    );
    expect(monitors).toHaveLength(1);
    const properties = monitors[0]?.Properties;
    // Errors are Sentry's; RUM's `http` telemetry would record request URLs,
    // and this app's include bearer-capability paths.
    expect(properties?.AppMonitorConfiguration?.Telemetries).toEqual(["performance"]);
    expect(properties?.AppMonitorConfiguration?.AllowCookies).toBe(false);
    expect(properties?.AppMonitorConfiguration?.EnableXRay).toBe(false);
    // RUM's own log group would have no retention policy, duplicating what
    // S13's bounded group already keeps.
    expect(properties?.CwLogEnabled).toBe(false);
    // The only server-side control on who may write here.
    expect(properties?.Domain).toBe("www.dive.day");
  });

  it("subscribes the operational mailbox to the alarm topic", () => {
    const subscriptions = Object.values(
      synthesize().findResources("AWS::SNS::Subscription") as Record<
        string,
        { Properties?: { Protocol?: string; Endpoint?: unknown } }
      >,
    );
    const email = subscriptions.filter((entry) => entry.Properties?.Protocol === "email");
    expect(email).toHaveLength(1);
    expect(email[0]?.Properties?.Endpoint).toBe("alerts@dive.day");
  });

  it("saves every Logs Insights query against the app group", () => {
    const definitions = Object.values(
      synthesize().findResources("AWS::Logs::QueryDefinition") as Record<
        string,
        { Properties?: { Name?: string; LogGroupNames?: string[]; QueryString?: string } }
      >,
    );
    expect(definitions).toHaveLength(SAVED_LOG_QUERIES.length);
    for (const definition of definitions) {
      expect(definition.Properties?.LogGroupNames).toEqual(["/diveday/app"]);
      expect(definition.Properties?.QueryString?.length).toBeGreaterThan(0);
    }
    expect(definitions.map((definition) => definition.Properties?.Name).sort()).toEqual(
      SAVED_LOG_QUERIES.map((query) => query.name).sort(),
    );
  });

  it("publishes one dashboard, with a widget for every signal", () => {
    const dashboards = Object.values(
      synthesize().findResources("AWS::CloudWatch::Dashboard") as Record<
        string,
        { Properties?: { DashboardName?: string; DashboardBody?: unknown } }
      >,
    );
    expect(dashboards).toHaveLength(1);
    const body = JSON.stringify(dashboards[0]?.Properties?.DashboardBody);
    for (const signal of LOG_SIGNALS) {
      expect(body).toContain(signal.metricName);
      expect(body).toContain(signal.title);
    }
  });

  it("hands the shipper's credentials to the app through the .env document, not an output", () => {
    const template = synthesize();
    const outputs = JSON.stringify(template.toJSON().Outputs);
    expect(outputs).toContain("/diveday/app");
    // The same rule the rest of the stack lives by: outputs carry names and
    // ARNs, never key material.
    expect(outputs).not.toContain("CLOUDWATCH_AWS_SECRET_ACCESS_KEY");
    expect(outputs).not.toContain("SecretAccessKey");
  });
});
