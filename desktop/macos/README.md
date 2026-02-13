# Codeburg macOS Shell (Electron)

This directory contains a macOS desktop shell that hosts the shared frontend from `frontend/`.

Quick start from repo root with `just`:

```bash
just start-macos
just start-macos-prod
```

## Development

1. Start the frontend dev server:

```bash
pnpm --dir frontend dev
```

2. In another terminal, run Electron shell:

```bash
pnpm --dir desktop/macos dev
```

In dev mode, the shell loads `http://localhost:3000` and uses Vite proxy defaults unless connection config has already been saved.

## Production-like local run

1. Build frontend assets:

```bash
pnpm --dir desktop/macos build:frontend
```

2. Start Electron against the built assets:

```bash
pnpm --dir desktop/macos start
```

If needed, override backend target at launch:

```bash
CODEBURG_SERVER_ORIGIN=https://codeburg.miscellanics.com pnpm --dir desktop/macos start
```

On first launch, the app asks for a server origin and persists it in:

`~/Library/Application Support/Codeburg/desktop-config.json`

Desktop auth token persistence uses Electron `safeStorage` and is saved in:

`~/Library/Application Support/Codeburg/auth-token.json`

## Environment overrides

These environment variables override saved config:

- `CODEBURG_SERVER_ORIGIN` (example: `https://codeburg.example.com`)
- `CODEBURG_API_HTTP_BASE` (example: `https://codeburg.example.com/api`)
- `CODEBURG_API_WS_BASE` (example: `wss://codeburg.example.com`)

## Packaging

```bash
pnpm --dir desktop/macos dist:dir
pnpm --dir desktop/macos dist
```

Packaging commands automatically sync `frontend/dist` into `desktop/macos/frontend-dist` for inclusion as app resources.
They also generate a macOS app icon at `desktop/macos/assets/codeburg.icns`.
