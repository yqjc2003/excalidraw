# Guidelines

- For new DOM/browser API usage, use `app.ownerDocument` and `app.ownerWindow` instead of globals; without `app`, derive them from the mounted node's `ownerDocument` and its `defaultView`.
- When overriding properties of an existing type, prefer `Merge<Base, Overrides>` from `@excalidraw/common/utility-types` over `Omit<Base, keyof Overrides> & Overrides`.

## This fork's scope (upstream excalidraw is stripped out)

- The app is a self-hosted, pure-frontend build. The upstream excalidraw backends, the official
  links (GitHub / X / Discord / YouTube / Excalidraw+ / signup) and all third-party telemetry
  (Sentry, simpleanalytics) have been removed on purpose. Do not reintroduce them.
- Upstream services are enabled purely through env vars, so they stay off until the user fills
  them in: `VITE_APP_BACKEND_V2_GET_URL` / `VITE_APP_BACKEND_V2_POST_URL` (server-side share
  links), `VITE_APP_WS_SERVER_URL` (collaboration), `VITE_APP_AI_BACKEND` (AI features).
  The UI hides the corresponding entry points when the env var is missing.
- `libraries.excalidraw.com` is intentionally kept: the user verified that the hosted library
  browser and the one-click "Add to" import work without any upstream backend of our own.
- `trackEvent` in `packages/excalidraw/analytics.ts` is a deliberate no-op; the
  `@excalidraw/excalidraw/analytics` API and all of its call sites are kept intact on purpose.
- The user authorizes committing and pushing straight to `origin/master` once the change
  typechecks, lints and builds — no extra confirmation needed. Commit messages follow English
  conventional commits, e.g. `feat(app): ...`.
