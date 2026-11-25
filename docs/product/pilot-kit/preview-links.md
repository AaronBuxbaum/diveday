# Preview links

A demo shop built for one prospect, in their name, main color, and town, with a link that opens it for a week. Decision and design: ADR [20261116-demo-previews](../../architecture/decisions/20261116-demo-previews.md).

## Build one

Run this where the production database connection is set, the same way `pnpm billing:free-term` runs:

```sh
pnpm preview build https://their-site.example
```

The command reads the shop's public home page once and prints the name, color, and town it found, then the link. Anything it got wrong can be given by hand, and `none` skips reading a site:

```sh
pnpm preview build none --name "Reef Line Divers" --color "#0a5c8f" --town "Islamorada" --region "FL"
```

Open the link yourself before sending it, in a browser marked as yours (`/api/demo/quiet`), so your look is not counted. The demo keeps its sample divers and boats. No logo or photograph of theirs is copied.

## Send it

The link goes in the cold email in place of `https://www.dive.day`, and in the day-10 Facebook or Instagram message ([the rhythm](cold-email-template.md#the-rhythm-four-touches-then-stop)). Say what it is in one sentence, for example: "I built a preview of DiveDay with your shop's name on it, and it stays open for a week." Nothing is emailed by the command.

## Read what happened

```sh
pnpm preview list
```

Each preview shows three numbers:

| Number | What it means |
| --- | --- |
| requested | The link's page was fetched. Mail scanners fetch every link, so this alone means nothing. |
| opened | A browser ran the page and entered the shop. |
| used | Somebody typed or tapped inside the shop. This is a person. |

The first time a preview is used, the alert inbox gets "Preview in use: <shop>" with the other two numbers beside it.

## When it ends

After seven days the link says the preview has ended and asks the reader to reply to the email. Build a new one to reopen it. The record of who looked is kept after the demo shop is deleted.
