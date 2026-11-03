# @lupin/connectors-email

A self-hosted HTTP email bridge: about and send for scheduled reports, in `chat` (text) or `full` (HTML) form.

The adapter implements `ConnectorAdapter` from `@lupin/connectors-sdk`: a dispatch table beside its manifest, the SDK's retry policy, and failures reported through `connectorFailure`. It talks `fetch` only — no SMTP client, no runtime dependency beyond the SDK — so the operator points it at their provider's HTTP send API or a small SMTP bridge, exactly as the Signal connector does. The secret is the bridge's base URL, passed per call and never stored here. Setup steps are in `site/guide/notifications.md`.
