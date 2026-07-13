# Panoptikon UI

A react-based web UI for the Panoptikon project.
Panoptikon will automatically pull and install the latest version of the UI from the `master` branch of this repository, so you don't actually need to do anything with this codebase unless you want to develop the UI itself.

## Prerequisites

You must have a running instance of the Panoptikon server to use this UI.

### Environment variables

- `PANOPTIKON_API_URL` — the base URL of the Panoptikon backend (default
  `http://127.0.0.1:6342`). It is used in exactly two places: as the target
  of the **dev-only** `/api`, `/docs` and `/openapi.json` rewrites (so
  `next dev` works without a gateway in front), and as the base URL for
  server-side rendering's own API fetches. Production builds emit **no**
  rewrites: the panoptikon gateway serves those routes itself and only
  forwards the remaining traffic to the UI server.
- `BUILD_STANDALONE=true` — opts `next build` into `output: "standalone"`
  for the panoptikon repo's `bundled-ui` feature (see `next.config.mjs`).

The former `DISABLE_API_PROXY`, `RESTRICTED_MODE`, `INFERENCE_API_URL`,
`DISABLE_BACKEND_OPEN_BTN` and `SEARCH_THROTTLE_MS` variables are gone:
their behavior moved into the gateway's per-policy configuration. The UI
asks `GET /api/client-config` what the matched policy allows (capability
booleans derived from the ruleset) and how it should behave (the free-form
`[policies.client]` table — recognized keys: `search_throttle_ms`,
`disable_backend_open`, `home_redirect`). Server-rendered pages make that
request — and every other SSR API call — with the gateway's short-lived
`x-panoptikon-policy` token echoed back, so SSR acts with the original
requester's policy rather than the UI server's network position. See the
panoptikon repo's `panoptikon/README.md` ("Policy-scoped SSR tokens" and
"`GET /api/client-config`") for the full mechanism and key conventions.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Desktop routes and Relay

`/desktop/setup` is the wizard-oriented onboarding route used by Panoptikon
Desktop. It reuses the normal database and scan components, records completion
through the Desktop-managed Server, and redirects ordinary Server deployments
away from the route.

Remote Panoptikon instances can pair with Panoptikon Desktop Relay v1 from the
file-open settings. Pairing requires local approval in Desktop, issues a unique
origin-bound credential, and replaces the retired global API-key `/open` and
`/config` protocol. Old browser-local Relay settings are intentionally not
migrated.
