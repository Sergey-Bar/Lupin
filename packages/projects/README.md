# @lupin/projects

The project registry's pure half: ecosystem and test-tool detection over a repository view, the declared-config merge, the repository scan and the QA health score. It holds no database or filesystem handle, so it runs the same in the API, a rehearsal and a fixture test.

```bash
pnpm --filter @lupin/projects test
```

Part of the [Lupin](https://github.com/Sergey-Bar/Lupin) monorepo; see the root README for the whole picture.
