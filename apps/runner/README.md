# @lupin/runner

The execution boundary. A runner registers with the API, claims jobs by lease, runs a declared argv with no shell, collects declared artifacts and logs within byte caps, and reports results with its fencing token so a lost lease cannot complete a job. A timed-out or cancelled command is ended together with every process it started.

```bash
pnpm --filter @lupin/runner test
```

Part of the [Lupin](https://github.com/Sergey-Bar/Lupin) monorepo; see the root README for the whole picture.
