# Contributing to the Kesh UI fork

The branch model, commit style and release process for all four fork repositories are in the repeater's [CONTRIBUTING.md](https://github.com/kesh33w/openhop_repeater/blob/kesh/bridge/CONTRIBUTING.md). Points specific to the UI:

- **Check out the repeater beside this repo** (`../openhop_repeater`).
  - `npm run api:generate` reads its `repeater/web/openapi.yaml`.
  - `npx vite build` writes the bundle into it.
- **Before opening a PR**, run:

  ```sh
  npm ci
  npm run api:check          # generated client matches the repeater spec
  npx vue-tsc --build
  npx vitest run
  npx eslint <files you changed>
  ```

  CI runs the first four.
- **ESLint is not gated yet.** Upstream code has 180 existing ESLint errors (mostly `any`). Keep files you change clean, and don't add new errors.
- **Shipping a change:** after the UI PR merges, rebuild the bundle into the repeater and commit it there as `Bundle <what> from UI <commit>`. Keep previously built hashed assets (`git ls-files -d repeater/web/html | xargs -r git checkout --`).
- **Secrets:** never put channel keys, backend credentials or tokens in `.env` files or test fixtures.
