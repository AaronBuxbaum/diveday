/**
 * The account-level SMS settings this stack owns: the monthly spend limit and
 * the country rules (infra-stack.ts S10). Both are account state with no
 * CloudFormation resource that can express them whole:
 *
 * - The spend limit is an API call, `SetTextMessageSpendLimitOverride`.
 * - `AWS::SMSVOICE::ProtectConfiguration` can hold country rules, but only by
 *   listing every country code AWS supports, and one code AWS does not accept
 *   fails the deploy. Here AWS supplies the list: a new protect configuration
 *   comes back with every country it knows, and this blocks all but the
 *   allowed ones. It cannot be made the account default in CloudFormation at
 *   all, and only the account default covers SNS, which is how DiveDay sends.
 *
 * The client is loaded at run time: the Lambda runtime ships the whole AWS SDK,
 * and the bundle leaves `@aws-sdk/*` out (infra-stack.ts `bundleLambdaHandler`).
 */

const SDK_MODULE = "@aws-sdk/client-pinpoint-sms-voice-v2";

export const NUMBER_CAPABILITIES = ["SMS", "MMS", "VOICE"] as const;
export type NumberCapability = (typeof NUMBER_CAPABILITIES)[number];

/** Updates sent per call. Well under the API's map limit, and small enough to read in a log. */
export const UPDATE_BATCH_SIZE = 100;

type CountryRuleSet = Record<string, { ProtectStatus?: string }>;
type CountryRuleUpdates = Record<string, { ProtectStatus: "ALLOW" | "BLOCK" }>;

/**
 * Every country AWS listed that is not already in the status it should be,
 * in batches. A country is allowed only when `allowed` names it; anything AWS
 * adds later arrives in `current` and is blocked by the next deploy.
 */
export function countryRuleUpdates(
  current: CountryRuleSet,
  allowed: readonly string[],
): CountryRuleUpdates[] {
  const changes = Object.entries(current)
    .map(([code, rule]) => {
      const wanted = allowed.includes(code) ? ("ALLOW" as const) : ("BLOCK" as const);
      return rule.ProtectStatus === wanted ? null : ([code, { ProtectStatus: wanted }] as const);
    })
    .filter((change) => change !== null)
    .sort(([a], [b]) => a.localeCompare(b));
  const batches: CountryRuleUpdates[] = [];
  for (let start = 0; start < changes.length; start += UPDATE_BATCH_SIZE) {
    batches.push(Object.fromEntries(changes.slice(start, start + UPDATE_BATCH_SIZE)));
  }
  return batches;
}

/** Texts may go only to these countries; MMS and voice go nowhere, since DiveDay sends neither. */
export function allowedFor(capability: NumberCapability, smsCountries: readonly string[]) {
  return capability === "SMS" ? smsCountries : [];
}

type Send = (command: string, input: Record<string, unknown>) => Promise<Record<string, unknown>>;

interface GuardEvent {
  RequestType: "Create" | "Update" | "Delete";
  PhysicalResourceId?: string;
  ResourceProperties: { MonthlySpendLimitUsd: string; AllowedSmsCountries: string[] };
}

/** Protect configuration ids look like `protect-<hex>`; anything else is a create that never finished. */
const isProtectConfigurationId = (id: string | undefined): id is string =>
  typeof id === "string" && id.startsWith("protect-");

export async function applySmsAccountGuard(event: GuardEvent, send: Send) {
  if (event.RequestType === "Delete") {
    // The spend limit is left where it is: dropping the override would put the
    // account back on whatever AWS defaults to, which is not a decision a
    // stack teardown should make. The country rules go with the stack.
    if (isProtectConfigurationId(event.PhysicalResourceId)) {
      await send("DeleteAccountDefaultProtectConfiguration", {}).catch(() => undefined);
      await send("DeleteProtectConfiguration", {
        ProtectConfigurationId: event.PhysicalResourceId,
      }).catch(() => undefined);
    }
    return { PhysicalResourceId: event.PhysicalResourceId };
  }

  const props = event.ResourceProperties;
  await send("SetTextMessageSpendLimitOverride", {
    MonthlyLimit: Number(props.MonthlySpendLimitUsd),
  });

  const created = !isProtectConfigurationId(event.PhysicalResourceId);
  const protectConfigurationId = created
    ? String(
        (await send("CreateProtectConfiguration", { DeletionProtectionEnabled: false }))
          .ProtectConfigurationId,
      )
    : (event.PhysicalResourceId as string);

  try {
    for (const capability of NUMBER_CAPABILITIES) {
      const { CountryRuleSet = {} } = await send("GetProtectConfigurationCountryRuleSet", {
        ProtectConfigurationId: protectConfigurationId,
        NumberCapability: capability,
      });
      for (const updates of countryRuleUpdates(
        CountryRuleSet as CountryRuleSet,
        allowedFor(capability, props.AllowedSmsCountries),
      )) {
        await send("UpdateProtectConfigurationCountryRuleSet", {
          ProtectConfigurationId: protectConfigurationId,
          NumberCapability: capability,
          CountryRuleSetUpdates: updates,
        });
      }
    }
    // Last, so the default only ever points at a finished rule set.
    await send("SetAccountDefaultProtectConfiguration", {
      ProtectConfigurationId: protectConfigurationId,
    });
  } catch (error) {
    // A half-built configuration this run created is nobody's; don't leave it behind.
    if (created) {
      await send("DeleteProtectConfiguration", {
        ProtectConfigurationId: protectConfigurationId,
      }).catch(() => undefined);
    }
    throw error;
  }

  return {
    PhysicalResourceId: protectConfigurationId,
    Data: { ProtectConfigurationId: protectConfigurationId },
  };
}

export async function handler(event: GuardEvent) {
  const sdk = await import(SDK_MODULE);
  const client = new sdk.PinpointSMSVoiceV2Client({});
  const send: Send = (command, input) => {
    console.log(command, JSON.stringify(input));
    return client.send(new sdk[`${command}Command`](input));
  };
  return applySmsAccountGuard(event, send);
}
