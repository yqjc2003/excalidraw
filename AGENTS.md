# Guidelines

- For new DOM/browser API usage, use `app.ownerDocument` and `app.ownerWindow` instead of globals; without `app`, derive them from the mounted node's `ownerDocument` and its `defaultView`.
- When overriding properties of an existing type, prefer `Merge<Base, Overrides>` from `@excalidraw/common/utility-types` over `Omit<Base, keyof Overrides> & Overrides`.

## This fork's scope (upstream excalidraw is stripped out)

- The app is a self-hosted, pure-frontend build. The upstream excalidraw backends, the official links (GitHub / X / Discord / YouTube / Excalidraw+ / signup) and all third-party telemetry (Sentry, simpleanalytics) have been removed on purpose. Do not reintroduce them.
- Upstream services are enabled purely through env vars, so they stay off until the user fills them in: `VITE_APP_BACKEND_V2_GET_URL` / `VITE_APP_BACKEND_V2_POST_URL` (server-side share links), `VITE_APP_AI_BACKEND` (AI features). The UI hides the corresponding entry points when the env var is missing.
- `libraries.excalidraw.com` is intentionally kept: the user verified that the hosted library browser and the one-click "Add to" import work without any upstream backend of our own. Publishing a library to the upstream public library is _not_ available (removed).
- Live collaboration is gone entirely — not just disabled. `excalidraw-app/collab/`, the `firebase` / `socket.io-client` dependencies, the `UserList` / `LiveCollaborationTrigger` components, the `AppState.collaborators` state, the remote cursor/selection rendering and the `userToFollow` / `onUserFollow` API are all removed. The `firebase-project/` directory (the upstream collab room config) is deleted too, and no locale key (`alerts.collab*`, `errors.collab*`, `errors.invalidEncryptionKey`) references it any more. Do not reintroduce them; the app is single-user by design.
- The library's collaboration _API surface_ is removed as well, so the docs match the code: `isCollaborating`, `updateScene({ collaborators })`, `<LiveCollaborationTrigger>` and `<WelcomeScreen.Center.MenuItemLiveCollaborationTrigger/>` no longer exist, and the `dev-docs` pages that described them are gone. Keep it that way — if collaboration is ever needed again, design a fresh API rather than restoring the upstream one.
- The whole behavioral-telemetry mechanism is gone: `packages/excalidraw/analytics.ts`, the `trackEvent` field on actions (`packages/excalidraw/actions/types.ts`), the `trackAction` helper in `packages/excalidraw/actions/manager.tsx` and every `trackEvent(...)` call site are all removed. Do not reintroduce them; if analytics are ever needed again, add a fresh implementation rather than restoring the upstream one.
- The user authorizes committing and pushing straight to `origin/master` once the change typechecks, lints and builds — no extra confirmation needed. Commit messages follow English conventional commits, e.g. `feat(app): ...`.

## Build & test gotchas

- `yarn build:app` fails with a wall of `TS6053: File 'excalidraw-app/build/assets/....js' not found` when `excalidraw-app/build/` already holds output. The root `tsconfig.json` includes `excalidraw-app` and does _not_ exclude `build`, so `vite-plugin-checker`'s `tsc` picks up the chunks vite is rewriting. Always `Remove-Item -Recurse -Force excalidraw-app\build` before building.
- `yarn test:code` only lints `--ext .js,.ts,.tsx`. Linting a `.mts` file (e.g. `excalidraw-app/vite.config.mts`) crashes `@typescript-eslint` with `TypeError: node.params is not iterable` — that is a toolchain limitation, not a defect in the file.
- Run vitest as `npx vitest run --maxWorkers=2 --minWorkers=1`. Higher concurrency causes mass "still loading" false failures, and running eslint alongside vitest exhausts memory.
- Baseline test failures in this repo (not caused by any change): 3 in `packages/excalidraw/components/Sidebar/Sidebar.test.tsx` and 7 in `packages/excalidraw/components/DefaultSidebar.test.tsx` (docking behaviour, `useTunnels(...) as it is null`).
- Vitest never cleans up snapshots it cannot reach: a `.snap` file whose test file was deleted stays in the repo forever, and the snapshots of an `it.skip` test are never refreshed. Both leave stale entries behind — delete them by hand when removing a feature.
