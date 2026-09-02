/**
 * The SES message tags the adapter sets on every send. They come back
 * verbatim on every event the configuration set publishes (`mail.tags` in
 * the SNS payload), so a complaint can be filed against the shop it concerns
 * without a message-id lookup the courtesy kinds never record
 * (`ses-events.ts`, `optOutAddressAfterComplaint`). Their own module so the
 * webhook's parser can name them without pulling the AWS SDK into its bundle.
 * SES accepts `[A-Za-z0-9_-]` in a tag, which a uuid and a kind name satisfy.
 */
export const SES_SHOP_TAG = "diveday_shop";
export const SES_KIND_TAG = "diveday_kind";
