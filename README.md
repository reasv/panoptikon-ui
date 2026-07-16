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

`/desktop/setup` is the wizard route used by Panoptikon Desktop. Its onboarding
mode configures the first/default index database without asking the user to
name or select one. Desktop considers that database ready when a scan has
started for one of its currently included folders. Once it is ready, Desktop
opens this route in new-database mode instead; that mode collects a unique
database name and creates it only when the wizard is finished. Closing the
initial wizard defers setup; it does not mark it skipped. Ordinary Server
deployments are redirected away from the route.

Folder choices are wizard-local state. Included and excluded paths have
separate tabs, are normalized and checked before leaving the step, and are
saved only when the wizard finishes. Desktop exposes a narrowly scoped native
multi-folder picker that appends selections to the active textarea.

The following Continuous scan step is also wizard-local. It stages optional
enablement, native-event versus hierarchical-polling change detection, the
polling interval, and an optional watched-folder whitelist. The whitelist is
normalized and checked against the staged full-scan include/exclude scope on
Continue; no setting or scan action is committed before the wizard finishes.

The wizard also stages supported file categories, an ordered free selection of
registry models with per-model batch/threshold sliders shown after selection,
and the database's routine schedule. Models are never preselected. Daily,
every-N-hours, and weekly controls generate five-field cron strings; advanced
users can edit a custom expression, which is previewed by the Desktop API with
its next local run time. A review step summarizes every staged choice before
Start Scan commits anything. The final, non-reversible Scan step tracks the
returned scan/model queue IDs and opens database-scoped Search or Scan pages in
the system browser. Links to the Scan page elsewhere in the Desktop wizard use
the same native browser-opening path. The initial jobs run even when later
automatic runs are disabled.

Remote Panoptikon instances can pair with Panoptikon Desktop Relay v1 from the
file-open settings. Pairing requires local approval in Desktop, issues a unique
origin-bound credential, and replaces the retired global API-key `/open` and
`/config` protocol. Old browser-local Relay settings are intentionally not
migrated. The UI does not probe or offer Relay on a Desktop-managed Server's
own endpoint: its existing file actions already run on that same computer.
Before pairing, Relay is exposed as a small corner action attached to each
Open button and shown only while that button is hovered or keyboard-focused;
it disappears after pairing. Paired file actions use Relay by default; their
right-click context menu provides a session-local switch to the existing
action. A restored pending request stays actionable so it can foreground
Desktop's dedicated pairing window again.
