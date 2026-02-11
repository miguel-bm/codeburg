# Codeburg macOS App Plan

This plan assumes the backend stays on the existing Codeburg server and the macOS app is a client that connects to it.

## Goals

1. Ship a macOS app with near-parity UI to the web app.
2. Reuse as much of `frontend/` as possible.
3. Avoid backend architecture changes beyond auth/CORS config updates.
4. Keep a clean path to maintain web and desktop from one frontend codebase.

## Recommended Approach

Use a desktop shell around the existing React app, not a native UI rewrite.

- Recommended shell: Tauri or Electron.
- UI layer: keep React + TypeScript from `frontend/`.
- Backend connectivity: direct HTTPS/WSS to existing remote Codeburg server.

Why this is the right first move:

- Maximizes code reuse.
- Keeps behavior close to current web app.
- Avoids a second product surface (separate native UI code).

## Architecture

```text
macOS app shell (Tauri/Electron)
  -> loads bundled React frontend
  -> frontend calls https://codeburg.example.com/api
  -> frontend opens wss://codeburg.example.com/ws and /ws/terminal
  -> backend remains unchanged for core business logic
```

## Required Frontend Changes (Shared by Web and Desktop)

Current frontend assumes same-origin API/WS paths. Introduce explicit runtime config:

1. `API_HTTP_BASE` (example: `https://codeburg.example.com/api`)
2. `API_WS_BASE` (example: `wss://codeburg.example.com`)

Implementation notes:

- Replace hardcoded `'/api'` in API client with configurable base.
- Replace `window.location.host`/`window.location.protocol` WS construction with configurable WS base.
- Keep defaults for web deploys so current behavior still works.

## Auth and Security Plan

### Token Storage

- Web can keep `localStorage`.
- macOS should use secure storage in the shell layer (Keychain).
- Add a small storage adapter abstraction in frontend.

### Passkeys

Passkeys are origin-bound. Decide one of these:

1. Browser-first auth in `https://codeburg.example.com`, then pass token to app.
2. Disable passkey login in desktop and use password/telegram auth in-app.
3. Add dedicated desktop auth flow later.

For MVP, choose option 2 or 1 to avoid blocking.

### CORS / Origin

- Ensure backend allowed origins include the app origin used by the shell.
- If shell uses local `http://localhost:*` asset host, this is already compatible with current CORS wildcard.
- If shell uses `tauri://` or `app://`, backend origin checks must be extended.

## Milestones

### M0 - Technical Design (0.5-1 day)

Deliverables:

- Choose shell tech (Tauri or Electron).
- Finalize config shape for API/WS base.
- Decide passkey strategy for MVP.

Exit criteria:

- Approved short design note and task breakdown.

### M1 - Shared Frontend Refactor (1-2 days)

Deliverables:

- Runtime config layer for HTTP and WS base URLs.
- Token storage adapter interface.
- No web regressions in existing app behavior.

Exit criteria:

- Web frontend still works unchanged in current deployment.
- App can point to an alternate backend URL via config.

### M2 - macOS Shell MVP (2-4 days)

Deliverables:

- App shell project in repo (for example `desktop/macos/`).
- Load bundled frontend build.
- Connect to remote backend.
- Login, dashboard, task detail, terminal WS verified.

Exit criteria:

- End-to-end workflow works from macOS app against remote server.

### M3 - Desktop Integration Polish (1-3 days)

Deliverables:

- Keychain token persistence.
- Native notifications bridge (replace browser Notification fallback when needed).
- External link handling and safe window policies.
- Basic crash logging.

Exit criteria:

- App survives restart with active auth session.
- Notifications and terminal usage are reliable.

### M4 - Packaging and Release (1-2 days)

Deliverables:

- Signed macOS `.app`.
- Notarized distributable (`.dmg` or `.zip`).
- Release checklist doc.

Exit criteria:

- Installable app on a clean Mac without bypass steps.

## Risks and Mitigations

1. Passkey login mismatch in desktop context.
Mitigation: use password/telegram for MVP, add browser-assisted passkey later.

2. WebSocket behavior differences in shell runtime.
Mitigation: add reconnect telemetry and explicit WS URL config early.

3. Token security concerns if stored in web storage.
Mitigation: Keychain-backed storage adapter for desktop.

4. Release friction from signing/notarization.
Mitigation: treat packaging as a dedicated milestone, not an afterthought.

## Repository Layout Suggestion

```text
frontend/                 # shared React app
desktop/
  macos/
    (tauri/electron project files)
docs/
  11-macos-app-plan.md
```

## Definition of Done

1. User can install macOS app.
2. User can configure backend URL once.
3. User can login and operate tasks/sessions from app.
4. Terminal streaming over WSS works reliably.
5. App updates do not require frontend code fork from web.
