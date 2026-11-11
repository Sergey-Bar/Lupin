# Scheduled reports

A short report — daily, weekly, or on your own schedule — to Slack, Microsoft Teams,
Telegram, WhatsApp, Signal, email, or Lupin's own inbox. Open **Settings → Reports**.

## What a report looks like

The same five-second shape on every platform, and the same shape as the **Dashboard** page:

```
🔴 Weekly quality report
92.4% passed across 118 runs.
🔴 checkout e2e failed 3 times
🔴 2 new flaky tests
🟡 Coverage −1.2 pts
+2 more
https://lupin.local:8443/dashboard/now
```

A status you can see before you read, one sentence, at most three items worst first,
how many more there are, and one link. A missed schedule — the server was off for a
week — sends one catch-up report, never a backlog.

### The dashboard at the head, and a chart

When the workspace has a project, the report leads with the dashboard's own sentence, so a
channel message and the screen cannot disagree about whether the week was good, and up to
three of the things that moved most:

```
Down 6 points since last week, mostly lower coverage and more flaky tests.
Coverage fell 10 pts (70% -> 60%)
Flaky tests rose by 3 (2 -> 5)
```

Beside it, on Slack, Telegram and Teams, goes a picture of the last twelve weeks: pull
requests merged each week as bars (the part an agent wrote in amber) above the score for
the same weeks. A week with no score is a gap in the line, and a change of scoring formula
breaks it rather than joining two scales. WhatsApp and Signal carry the text only. A
workspace with no project gets the report it always did.

If a platform refuses the picture before anything is sent, the same report goes out as
text. A failure that may have delivered the message is not followed by a second one.

### The link in a report

The **Project scope** menu at the top of the sidebar, shown when the workspace has more than
one project, chooses which project the pages are about. The choice is kept in the address
(`?project=`), so a shared link opens the same project, and every sidebar link to a page that
reads it keeps it. _All projects_ is the default: Home's verdict is then the project that
reported most recently. A schedule can name its own project (the _Project_ menu on the Reports
page, shown when there is more than one), and its dashboard section is then about that project;
without one it follows that default.

The one link at the foot of a report opens the dashboard. It uses the address in
`LUPIN_PUBLIC_URL` (`PUBLIC_APP_URL` outside the compose stack). While that address is a
loopback one, such as the default `http://localhost:8080`, the report goes **without a
link**, because the link would open the reader's own machine and not yours. Set it to the
address people actually use, such as your [Cloudflare hostname](/guide/remote-cloudflare)
or LAN name, and the link appears from the next report.

The dashboard lists, under _Worth a look_, the pull requests that match one of
three stated facts: a large change with no test file, a merge with no approval from a
person, and an open AI-attributed change nobody has approved. It is a list with the reason
beside each, not a score. It reads pull requests the GitHub sync has stored.

## Set it up in three steps

1. **Where.** Add a channel. Start with **Lupin inbox**: it needs no account, and its
   reports appear in the history on the same page.
2. **When.** Pick **Daily 09:00**, **Weekly, Monday 09:00**, or **Custom** (a cron
   expression such as `0 8 * * 1-5` for weekdays at 08:00). The timezone defaults to your
   browser's. **Quiet hours** (say 22:00 to 07:00, in that timezone) hold a report that comes
   due inside them until they end; while one is waiting, a later one is folded into it, so
   an hourly report wakes nobody and the morning brings one message, not nine.
3. **Did it arrive.** **Send a test** on any channel; the result appears in the history
   and as a toast. A failed delivery shows the platform's error code, for example
   `telegram_rejected_401` for a wrong bot token.

Adding or removing a channel needs the **admin** role (a channel holds a credential);
scheduling needs **operator**; everyone can read the history. Credentials are encrypted
in the vault (`VAULT_SECRET` must be set) and never shown again.

## Each platform, in five steps or fewer

### Slack

1. At api.slack.com/apps, **Create New App → From scratch**.
2. **OAuth & Permissions → Bot Token Scopes**: add `chat:write`, and `files:write` if you want the chart in the message.
3. **Install to Workspace** and copy the **Bot User OAuth Token** (`xoxb-…`).
4. In the Slack channel, `/invite @your-app`.
5. In Lupin: Slack, channel `#your-channel`, paste the token. To get the chart, give the channel's **id** (`C0123456789`: right-click the channel, **View channel details**, bottom of the dialog) instead of its name. With a name, or without `files:write`, the report goes out as text. The upload follows Slack's documented three-step flow and has not been run against a workspace here.

### Microsoft Teams

1. In the Teams channel, **⋯ → Workflows**.
2. Choose **Post to a channel when a webhook request is received**.
3. Finish the wizard and copy the URL it shows.
4. In Lupin: Microsoft Teams, paste the URL.

Office 365 "Incoming Webhook" connectors are retired by Microsoft; Workflows is the
replacement. The URL is the credential — keep it like a password.

The chart is placed in the card as an inline image. Whether Teams draws it has not been
checked against a tenant; if it does not, the card still carries the whole report as text.

### Telegram

1. Message **@BotFather**, send `/newbot`, and copy the token.
2. Add the bot to your group (or message it directly).
3. Send any message in that chat, then open
   `https://api.telegram.org/bot<token>/getUpdates` and copy `chat.id` (groups start with `-100`).
4. In Lupin: Telegram, chat id, paste the token.

The chart is sent as a photo with the report as its caption (Telegram allows 1,024
characters there). If Telegram refuses the photo, the full text is sent instead.

### WhatsApp

WhatsApp only lets a business start a conversation with an **approved template**, so this
one takes Meta's review (usually under a day).

1. Create a Meta Business account and a WhatsApp Cloud API app at developers.facebook.com.
2. Note the **Phone number ID** and create a **system-user access token**.
3. In WhatsApp Manager, create a template (category _Utility_) whose body is `{{1}}`.
4. Wait for approval.
5. In Lupin: WhatsApp, phone number id, recipient (digits, country code first),
   template name and language, paste the token.

### Signal

Signal has no official bot API. Lupin uses the self-hosted
[`signal-cli-rest-api`](https://github.com/bbernhard/signal-cli-rest-api) bridge, shipped
as an optional service in the compose file.

1. `docker compose --profile signal up -d signal`
2. Link it to a Signal account once: open `http://localhost:8080/v1/qrcodelink?device_name=lupin`
   on the server (publish the port temporarily, or use `docker compose exec`) and scan it
   from Signal → **Settings → Linked devices**.
3. In Lupin: Signal, the account's number (`+15551234567`), the recipients
   (comma-separated numbers or group ids), and bridge URL `http://signal:8080`.

The bridge is reached only from inside the compose network; it is never published.

### Email

Lupin has no SMTP client of its own. It sends email through a small HTTP bridge you run: your
mail provider's send API, or a container that speaks SMTP on one side and answers
`POST /send` on the other.

1. Run a bridge that accepts `POST /send` with JSON `{ from, to: [..], subject, text, html? }`
   and answers 2xx when the message is sent, and a 4xx `{ "error": "..." }` when it refuses.
   `GET /about` is used to test the connection.
2. In Lupin: Email, the sender, the recipients (comma-separated) and a subject, and the
   bridge's base URL as the credential.
3. Choose the report format on the schedule: _full_ sends the rich HTML report with a text
   alternative, _chat_ sends the digest as text.

A bridge error after a send (a 5xx) is not retried, because the message may have arrived.
This has been tested against a stand-in bridge, not a real mail provider.

## How it works

Saving a schedule writes a `schedules` row the worker fires. The worker — which has the
clock but not the vault — queues one `report_deliveries` row per occurrence; the key is
unique, so two workers queue it once. The API's dispatcher claims queued rows with
`FOR UPDATE SKIP LOCKED`, opens the channel's credential, renders for the platform and
sends. A rate limit is retried with backoff up to three attempts; anything else fails
visibly with the platform's code. `REPORT_DISPATCH_INTERVAL_MS` (default 15000) is how
often the dispatcher looks.
