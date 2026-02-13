# macOS Desktop Next Steps

Date: February 13, 2026
Scope: Detailed execution plan for the next desktop milestones after the Electron MVP.

## Current Baseline

Implemented today:

- Shared frontend runtime config for API/WS base URLs.
- Desktop shell (`desktop/macos`) with first-run server setup.
- Desktop token persistence bridge backed by Electron `safeStorage`.
- Packaging smoke build (`dist:dir`) producing a local `.app`.

Known gaps:

- No Apple signing identity or notarization pipeline yet.
- Desktop server origin is only configurable in the setup HTML, not in React Settings.
- No desktop-focused automated smoke tests.
- Passkeys fail in desktop shell due to RP ID/origin mismatch.

## Why Passkeys Fail In Desktop Right Now

Observed error:

- `The RP ID "codeburg.miscellanics.com" is invalid for this domain`

Root cause:

- WebAuthn passkeys are bound to the page origin.
- Desktop renderer origin is currently local (`http://localhost:<port>`), but passkeys were registered for `codeburg.miscellanics.com`.
- Browser/Electron correctly rejects passkey assertions when RP ID does not match current origin context.

MVP decision:

- Keep desktop auth to password/Telegram for now.
- Treat passkeys as a separate authentication milestone (browser-assisted flow or architecture change).

## 1) Signing + Notarization For Release Distribution

### Goal

Produce installable, trusted macOS artifacts (`.dmg`/`.zip`) without Gatekeeper warnings.

### Deliverables

- Signed app with `Developer ID Application`.
- Signed installer (if used) with `Developer ID Installer`.
- Successful notarization and stapling.
- CI-friendly release script and checklist.

### Prerequisites

- Apple Developer account with Team ID.
- Certificates created and imported in Keychain:
  - `Developer ID Application: <Name> (<TEAM_ID>)`
  - `Developer ID Installer: <Name> (<TEAM_ID>)` (optional, recommended)
- App-specific password for notarization or App Store Connect API key.

### Code/Config Changes

Files:

- `desktop/macos/package.json`
- `desktop/macos/entitlements.mac.plist` (new)
- `desktop/macos/entitlements.mac.inherit.plist` (new)
- `desktop/macos/scripts/notarize.js` (new, if using custom hook)

`package.json` `build` section updates:

- Add explicit `identity`.
- Add `hardenedRuntime: true`.
- Add entitlements paths.
- Add `notarize` configuration.
- Add optional `afterSign` script for custom notarization step.

Environment-driven secrets:

- `APPLE_TEAM_ID`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- or `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`

### Recommended Command Flow

Local release build:

```bash
pnpm --dir desktop/macos dist
```

Verification:

```bash
codesign --verify --deep --strict --verbose=2 "desktop/macos/dist/mac-arm64/Codeburg.app"
spctl --assess --type execute --verbose=4 "desktop/macos/dist/mac-arm64/Codeburg.app"
```

### Acceptance Criteria

- `spctl` assessment passes on a clean macOS machine.
- Notarization request succeeds and is stapled.
- Downloaded artifact launches without bypass dialogs.

### Risks

- Missing entitlements causes runtime failures.
- Incorrect certificate selection signs with ad-hoc identity.
- Notary credential handling in CI can leak if not scoped correctly.

## 2) In-App Desktop Settings For Server Origin

### Goal

Let users change desktop backend target from React Settings, not only first-run setup.

### Deliverables

- New Desktop section in existing `Settings` page.
- Read/write current server origin via preload bridge.
- Immediate reconnect behavior guidance after save.
- Validation and error handling in UI.

### UX Behavior

- Show when running in desktop shell.
- Input: `Server Origin` (example `https://codeburg.miscellanics.com`).
- `Save` button persists via Electron IPC.
- Show success/error toast/banner.
- On save:
  - Option A: prompt app restart.
  - Option B: soft-reload page and reconnect sockets.

### Implementation Plan

Frontend files:

- `frontend/src/pages/Settings.tsx`
- `frontend/src/platform/runtimeConfig.ts` (read-only display helpers)
- `frontend/src/api/...` (no API schema change needed)

Desktop bridge files:

- `desktop/macos/src/preload.js` (already exposes `codeburgDesktop`)
- `desktop/macos/src/main.js` (already supports get/set)

Type safety:

- Add global type declaration for `window.codeburgDesktop` in frontend.

Validation rules:

- Accept only `http://` or `https://`.
- Normalize trailing slash.
- Reject path/query fragments.

### Acceptance Criteria

- User can change origin from Settings and confirm persisted value.
- App reconnects to new backend target after reload/restart.
- Invalid URLs are blocked with clear inline error.

### Risks

- Mid-session origin switch can leave stale WS subscriptions.
- If backend CORS does not include desktop local origin pattern, auth appears as `Failed to fetch`.

## 3) Desktop Smoke Tests (Connection + Token Persistence)

### Goal

Catch desktop regressions early for server targeting and secure token persistence behavior.

### Test Scope

1. Connection setup
- first launch without config shows setup page.
- save valid origin, app transitions to frontend.
- persisted origin is loaded on relaunch.

2. Token storage behavior
- token writes via `__CODEBURG_TOKEN_STORAGE__`.
- token reads after relaunch.
- logout clears persisted token file.

3. Runtime config injection
- `window.__CODEBURG_CONFIG__` exposes expected `apiHttpBase` and `apiWsBase`.

### Tooling Options

Recommended:

- Playwright Electron mode for end-to-end desktop smoke tests.

Alternative:

- Spectron-style approaches are mostly legacy and less maintained.

### Repository Additions

- `desktop/macos/tests/smoke.spec.ts` (new)
- `desktop/macos/playwright.config.ts` (new)
- `desktop/macos/package.json` scripts:
  - `test:smoke`
  - `test:smoke:headed`

### CI Strategy

Initial:

- Run smoke tests on macOS runner only.
- Keep to one or two critical test cases to avoid flaky pipelines.

Later:

- Expand scenarios (network interruption, invalid origin, token corruption).

### Acceptance Criteria

- Smoke suite passes locally and in CI macOS job.
- Regression in setup/token flow fails test deterministically.

### Risks

- Electron startup timing can create flaky assertions.
- Tests that rely on external network endpoints can be unstable; prefer local mock server for CI.

## Suggested Delivery Sequence

1. Build desktop settings panel first (fast UX win and operational control).
2. Add smoke tests for settings + token persistence paths.
3. Implement signing/notarization once behavior stabilizes.

Reason:

- Avoid spending notarization effort before desktop runtime behavior is stable.

## Additional Desktop Polishing (Implemented February 13, 2026)

These were requested and are now implemented in `desktop/macos/src/main.js`.

### Native App Identity + Menu (Done)

Files:

- `desktop/macos/src/main.js`
- `desktop/macos/package.json`

Tasks:

- Set app name explicitly at startup (`app.setName("Codeburg")`).
- Define `Menu.buildFromTemplate(...)` with:
  - App menu (`About`, `Preferences`, `Quit`)
  - Edit menu (`Undo`, `Redo`, `Cut`, `Copy`, `Paste`)
  - View menu (`Reload`, `Toggle DevTools` in dev only)
  - Window menu (`Minimize`, `Zoom`, `Bring All to Front`)
- Add menu action to open Settings route in React app.

### macOS Title Bar Styling (Done)

In `BrowserWindow` options:

- `titleBarStyle: "hiddenInset"` for native macOS integrated traffic lights.
- Optional `trafficLightPosition` for custom layout.
- Optional overlay/title controls only if we add a custom draggable header.

Note:

- In dev mode, Electron may still present generic branding in some OS surfaces.
- Packaged builds (`Codeburg.app`) are the source of truth for final app identity visuals.

## Definition Of Done For This Next Phase

All items below must be true:

- Signed + notarized installable artifact validated on clean machine.
- Desktop backend origin editable inside React Settings UI.
- Desktop smoke tests cover first-run connection and token persistence.
- App identity/menu/title bar reflect Codeburg, not generic Electron defaults.
