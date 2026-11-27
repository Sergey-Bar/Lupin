# Connectors, and how each one is proven

Lupin talks to seven platforms. Each has a **verification level**, recorded in
`docs/quality/release-journeys.json` and checked by `pnpm release:readiness`:

- **fake-verified**: a test drives the production adapter, vault and dispatcher against a fake of
  the platform built from its public API documentation. The fake refuses what the documentation
  says the platform refuses (a Slack post with no channel, a Jira description that is not an
  Atlassian Document, a WhatsApp template parameter with a newline), and answers 429 and 5xx
  when told to. Its sources and the date they were read are in
  `apps/api/src/test-support/connector-fakes.ts`.
- **live-verified**: the opt-in `connectors-live` workflow has called the platform with a real
  account and the call succeeded.

| Platform                     | What Lupin does                                                 | Level         |
| ---------------------------- | --------------------------------------------------------------- | ------------- |
| GitHub                       | Pull-request gate statuses and comments, delivery reads, issues | fake-verified |
| Jira Cloud                   | An issue from a failure cause or a finding                      | fake-verified |
| Slack                        | Scheduled reports and alerts, with the chart                    | fake-verified |
| Microsoft Teams              | Reports to an incoming webhook                                  | fake-verified |
| Telegram                     | Reports, with the chart                                         | fake-verified |
| WhatsApp Cloud API           | Reports through an approved template                            | fake-verified |
| Signal (signal-cli REST API) | Reports through your bridge                                     | fake-verified |

## Help raise a connector to live-verified

If you have an account on one of these platforms, you can prove its connector for everyone:

1. Fork the repository and add the connector's secret to your fork, under the name below.
2. Run **Actions → Live connector probes**. Each probe is a read (an identity or about call); none
   posts anything.
3. Open a pull request with the passing run's link, raising that connector's `verification` to
   `live-verified` in `docs/quality/release-journeys.json`.

| Platform | Secret                                      | Also needs (a repository variable)      |
| -------- | ------------------------------------------- | --------------------------------------- |
| GitHub   | `LUPIN_LIVE_GITHUB_TOKEN`                   | `LUPIN_LIVE_GITHUB_REPO` (`owner/repo`) |
| Jira     | `LUPIN_LIVE_JIRA_TOKEN`                     | `LUPIN_LIVE_JIRA_BASE_URL`              |
| Slack    | `LUPIN_LIVE_SLACK_TOKEN`                    |                                         |
| Telegram | `LUPIN_LIVE_TELEGRAM_TOKEN`                 |                                         |
| WhatsApp | `LUPIN_LIVE_WHATSAPP_TOKEN`                 | `LUPIN_LIVE_WHATSAPP_PHONE_ID`          |
| Signal   | `LUPIN_LIVE_SIGNAL_BRIDGE` (the bridge URL) |                                         |

Teams has no live probe: an incoming webhook has no read, so any call to it would post a message.
