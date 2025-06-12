# Panoptikon UI

A react-based web UI for the Panoptikon project.
Panoptikon will automatically pull and install the latest version of the UI from the `master` branch of this repository, so you don't actually need to do anything with this codebase unless you want to develop the UI itself.

## Prerequisites

You must have a running instance of the Panoptikon server to use this UI.
Set the `PANOPTIKON_API_URL` environment variable to the URL of the Panoptikon server.
By default, Panoptikon runs at `http://127.0.0.1:6342`, and the UI will automatically use this URL if `PANOPTIKON_API_URL` is not set.

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
