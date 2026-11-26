---
title: Connect Jira
description: Connect a project to Jira Cloud or Jira Data Center so Lupin can open an issue from a failure cause or a health finding, and what happens when Jira is slow, refuses, or rate-limits.
outline: deep
---

# Connect Jira

Lupin opens Jira issues in one direction: from a failure cause on the Tests page, or from a
[health finding](repository-health.md), an operator chooses **Open issue → Jira**. It does not
read Jira back, change an issue, or take webhooks from it.

## What you need

- The Jira site, as an `https` address: `https://acme.atlassian.net` for Jira Cloud, or your
  Data Center address.
- The key of the Jira project the issues go into, such as `ACME`.
- An API token for an account that can create issues in that project. On Jira Cloud, create one
  at **Atlassian account → Security → API tokens**; on Data Center, a personal access token.
- `VAULT_SECRET` set on the install (the start scripts set it for you), because Lupin seals the
  token in its vault and never shows it again.

## Connect a project

Connecting is one request as an admin. Replace the values in capitals:

```bash
curl -X PUT "$LUPIN/api/v1/projects/$PROJECT/issue-tracker" \
  -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"baseUrl":"https://acme.atlassian.net","projectKey":"ACME","issueType":"Bug","token":"YOUR_TOKEN"}'
```

- `issueType` is optional and defaults to `Bug`.
- To change the project key or issue type later, send the request again without `token`; the
  sealed token is kept. Moving to a different site needs the token again, so a token is never
  sent to a host it was not given for.
- `GET` on the same address says whether a token is stored (`hasCredential`), and `DELETE`
  removes the connection. Issues already opened stay linked.

## Open an issue

On **Tests → Causes**, each cause has **Open issue**. Choose Jira, and Lupin files one issue with
the error signature, a sample message, the first 20 failing tests and a link back to the run.
The cause then shows the issue key instead of the button. The same is available from a health
finding, and through the API as described in [Issues and test proposals](issues-and-test-proposals.md).

Asking twice opens one issue: a repeat answers with the issue already opened, and a script can
also send an `Idempotency-Key` header.

## When Jira says no

| What Jira answered                    | What Lupin does                                                                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `401` or `403`                        | Reports that the token cannot create issues there. Nothing is retried; fix the token or its project permission.   |
| `404`                                 | Reports that the project key or site is wrong.                                                                    |
| `429` with `Retry-After`              | Stops at once and reports the time Jira named, so it is not asked again before then.                              |
| `429` without `Retry-After`           | Tries twice more, a fraction of a second apart.                                                                   |
| `5xx`, or no answer within 10 seconds | Reports the failure and does **not** retry, because the issue may already exist. Check Jira before you try again. |

Every failure has a stable code (`jira_401`, `jira_429`, `jira_transport_failed`) and never
carries Jira's own response text, so a token Jira echoes back cannot end up in a log.

## Checking it from the install

`/metrics` counts Jira calls and failures as `lupin_connector_calls_total{connector="jira"}` and
`lupin_connector_failures_total{connector="jira"}`, and the bundled alert rules warn when a
connector fails three times in 30 minutes. See [Run it for an organisation](operations-enterprise.md#watching-it).
