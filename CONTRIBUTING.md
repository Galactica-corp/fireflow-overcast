# Contributing

Thank you for contributing to FireFlow Overcast.

This repository is an Apache 2.0 public snapshot of the Overcast node package from FireFlow. **Canonical development happens in the FireFlow monorepo** (`packages/fireflow-overcast`). Changes here are refreshed from that source for each public release.

If FireFlow is not yet public and you have access to it, prefer opening the change there. PRs against this repository are still welcome, especially for documentation, license, and repository infrastructure.

## Requirements

- Node.js 24 or newer
- pnpm 11 (`packageManager` is pinned in `package.json`)
- A local FireFlow checkout to typecheck or run tests (see the README)

## Pull requests

1. Fork and create a branch from `main`.
2. Keep the change focused. Do not mix license/infrastructure edits with node behavior.
3. Every new or modified `.ts` file must carry this header:

   ```ts
   /*
    * Copyright 2026 PersistentAI
    *
    * SPDX-License-Identifier: Apache-2.0
    */
   ```

4. Run `pnpm check:license` locally. If you have FireFlow wired as a peer, also run `pnpm typecheck` and `pnpm test`.
5. Fill in the pull request template.

## License of contributions

By submitting a contribution you license it under the [Apache License 2.0](LICENSE), copyright PersistentAI, and confirm you have the right to do so. This is the same grant as a CLA: PersistentAI may include your contribution in FireFlow and in this public snapshot.

## Code of conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
