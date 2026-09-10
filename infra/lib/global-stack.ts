import * as cdk from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import type { Construct } from "constructs";
import { UPTIME_TARGETS, uptimeAlarmNameFor } from "./observability";
import { alertEmailFrom, UPTIME_ALARM_TOPIC_NAME, webhookHostFrom } from "./stack-config";

/**
 * The external uptime monitor -- the one check that runs outside the thing it
 * checks. See ADR 20260907-external-uptime-monitor and the `UPTIME_TARGETS`
 * header in `infra/lib/observability.ts` for what it costs and why the body is
 * matched as well as the status code.
 *
 * Everything in the main stack's S13 reads a line the app wrote, so all of it
 * goes quiet in the one failure it would most want to report. Route 53's
 * checker fleet polls the public URL from several AWS regions that are not this
 * account, and publishes `HealthCheckStatus` to CloudWatch whether the app is
 * running or not.
 *
 * **It is a stack of its own because the alarm has to live in us-east-1.**
 * Route 53 is a global service and publishes its health-check metrics there and
 * nowhere else. This was a section of the main stack for as long as the main
 * stack was in us-east-1 too, and read as an ordinary same-region alarm; the
 * day `PRIMARY_REGION` moves, that alarm would read an empty series, and
 * because `treatMissingData` here is BREACHING rather than the estate's usual
 * NOT_BREACHING, it would not go quiet -- it would page somebody every few
 * minutes about an outage that is not happening. Splitting it out is what makes
 * `PRIMARY_REGION` a line anybody can change (ADR 20260910-one-region-in-us-east-2;
 * docs/engineering/region-migration.md).
 *
 * The price is a third alarm topic and a third confirmation click, for the same
 * reason the email stack has its own: an alarm may only notify an SNS topic in
 * its own region, so a us-east-1 alarm cannot reach a topic that has moved.
 * Paying it once here is cheaper than discovering it during a migration.
 */
export class GlobalStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    const webhookHost = webhookHostFrom(this);
    const alertEmail = alertEmailFrom(this);

    const uptimeAlarms = new sns.Topic(this, "UptimeAlarms", {
      topicName: UPTIME_ALARM_TOPIC_NAME,
      displayName: "DiveDay uptime alarms",
    });
    uptimeAlarms.addSubscription(new subscriptions.EmailSubscription(alertEmail));
    const alarmAction = new cloudwatchActions.SnsAction(uptimeAlarms);

    const uptimeHost = new URL(webhookHost).hostname;
    for (const target of UPTIME_TARGETS) {
      const healthCheck = new route53.CfnHealthCheck(this, `${target.constructId}HealthCheck`, {
        healthCheckConfig: {
          // `HTTPS_STR_MATCH`, not `HTTPS`: a 200 proves something answered,
          // not that DiveDay did. The literal is the route's own verdict.
          type: "HTTPS_STR_MATCH",
          fullyQualifiedDomainName: uptimeHost,
          port: 443,
          resourcePath: target.resourcePath,
          searchString: target.searchString,
          requestInterval: target.requestIntervalSeconds,
          failureThreshold: target.failureThreshold,
          // The app is served from a shared host behind SNI; without this the
          // checker's TLS handshake reaches the wrong certificate.
          enableSni: true,
          // A second optional feature would be a third dollar a month, and
          // latency from AWS's checker regions is not how this app learns it is
          // slow -- CloudWatch RUM and the web-vital signals are.
          measureLatency: false,
        },
        healthCheckTags: [{ key: "Name", value: uptimeAlarmNameFor(target) }],
      });

      new cloudwatch.Alarm(this, `${target.constructId}UptimeAlarm`, {
        alarmName: uptimeAlarmNameFor(target),
        alarmDescription: `${target.title}. ${target.response}`,
        metric: new cloudwatch.Metric({
          namespace: "AWS/Route53",
          metricName: "HealthCheckStatus",
          dimensionsMap: { HealthCheckId: healthCheck.attrHealthCheckId },
          // `Minimum`, not `Average`: the metric is 1 or 0 per minute, and an
          // average would let a recovering minute paper over a dead one.
          statistic: "Minimum",
          period: cdk.Duration.minutes(1),
        }),
        threshold: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
        // Two minutes on top of Route 53's own three consecutive failed rounds:
        // about four minutes from "the site went away" to an email, which is
        // faster than a shop noticing and slow enough that a deploy's own
        // rollover does not page anyone.
        evaluationPeriods: 2,
        // **Breaching, and this is the one alarm in the estate where it is,**
        // which is also why this stack is pinned to us-east-1 rather than
        // following the rest. Every other alarm treats missing data as healthy
        // because a quiet app is a healthy app. Here missing data means the *monitor* stopped
        // reporting, and an external monitor that has gone quiet is
        // indistinguishable from the outage it exists to catch. A false page
        // when Route 53 has an off day is the cheaper mistake.
        treatMissingData: cloudwatch.TreatMissingData.BREACHING,
      }).addAlarmAction(alarmAction);

      new cdk.CfnOutput(this, `${target.constructId}HealthCheckId`, {
        value: healthCheck.attrHealthCheckId,
        description: `Route 53 health check polling https://${uptimeHost}${target.resourcePath} every ${target.requestIntervalSeconds}s from outside this account. Console: Route 53 -> Health checks. Test the alert path once by inverting it (see docs/engineering/incident-response-runbook.md).`,
      });
    }

    new cdk.CfnOutput(this, "UptimeAlarmTopicArn", {
      value: uptimeAlarms.topicArn,
      description: `SNS topic the uptime alarms notify. Its email subscription to ${alertEmail} needs the same one-time confirmation click as the other two alarm topics (manual action confirm-observability-alarms).`,
    });
  }
}
