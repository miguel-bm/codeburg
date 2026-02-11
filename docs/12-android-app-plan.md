# Codeburg Android App Plan

This plan assumes the backend remains on the existing remote Codeburg server and Android is a client application.

## Goals

1. Deliver an Android app for day-to-day Codeburg usage.
2. Share the existing frontend code as much as possible.
3. Keep maintenance cost low by avoiding a full second UI stack.
4. Preserve terminal and real-time workflows over mobile networks.

## Recommended MVP Strategy

Use a wrapper app around the existing web frontend, then decide later if a native UI rewrite is justified.

Practical options:

1. WebView-based shell app loading bundled frontend assets.
2. TWA/custom tab strategy loading hosted web app.
3. Full React Native or Kotlin Compose rewrite (not recommended for first release).

Recommendation:

- MVP: WebView shell with shared React frontend code.
- Re-evaluate native rewrite only after usage data and performance feedback.

## Architecture

```text
Android app shell
  -> renders shared React frontend
  -> frontend calls https://codeburg.example.com/api
  -> frontend opens wss://codeburg.example.com/ws and /ws/terminal
  -> backend remains central and unchanged for core logic
```

## Shared Code Plan

Keep one frontend app with platform adapters:

1. `networkConfig` adapter
2. `authTokenStorage` adapter
3. `notifications` adapter
4. `externalLinks` adapter

Default web implementations remain unchanged.
Android shell provides native-backed implementations where needed.

## Required Frontend Changes

The same refactor needed for macOS should be reused:

1. Configurable HTTP API base URL.
2. Configurable WS base URL.
3. Storage abstraction for auth token.

Android-specific considerations:

- Handle app background/foreground transitions and WS reconnect.
- Handle keyboard resize and viewport changes for terminal-heavy screens.
- Graceful fallback for unsupported browser APIs.

## Auth and Security Plan

### Token Handling

- Do not rely on raw `localStorage` for production mobile auth persistence.
- Store token in encrypted Android storage via shell bridge.
- Keep token handling behind frontend adapter interface.

### Passkeys

Passkeys are origin-bound and can be difficult in embedded app contexts.

MVP options:

1. Password login in app.
2. Browser-assisted login flow and return token via deep link.

Defer full in-app passkey support until core app is stable.

### Transport Security

- Force HTTPS/WSS only.
- Optional: certificate pinning at shell level in later milestone.

## Milestones

### A0 - Scope and Shell Choice (0.5-1 day)

Deliverables:

- Decide shell stack for Android.
- Finalize MVP auth method.
- Confirm store distribution target (internal test track first).

Exit criteria:

- Approved implementation checklist.

### A1 - Shared Frontend Refactor (1-2 days)

Deliverables:

- HTTP/WS base URL config support.
- Token storage adapter abstraction.
- No regressions in web deployment.

Exit criteria:

- Frontend can run against explicit remote backend URL without same-origin assumptions.

### A2 - Android Shell MVP (2-5 days)

Deliverables:

- Android project in repo (for example `mobile/android/`).
- App loads shared frontend.
- Login works.
- Dashboard/task views work.
- Real-time session updates and terminal streaming verified.

Exit criteria:

- Internal APK build usable for daily workflows.

### A3 - Mobile UX Hardening (2-4 days)

Deliverables:

- Background/foreground reconnection behavior.
- Better virtual keyboard behavior for terminal input.
- Native notifications path.
- Offline/error states for unstable networks.

Exit criteria:

- Stable app session under normal mobile connectivity conditions.

### A4 - Release Pipeline (1-3 days)

Deliverables:

- Signed release build.
- Play Console internal testing setup.
- Release notes and known limitations doc.

Exit criteria:

- Installable build distributed through internal testing track.

## Risks and Mitigations

1. Terminal UX on small screens is harder than desktop.
Mitigation: prioritize input reliability and viewport handling before visual polish.

2. WebView API differences can break some browser-dependent features.
Mitigation: add capability checks and adapter fallbacks.

3. Background disconnects can cause stale state.
Mitigation: explicit reconnect strategy on app resume.

4. Security regression if tokens are stored insecurely.
Mitigation: enforce encrypted storage through a native bridge.

## Repository Layout Suggestion

```text
frontend/                  # shared React app
mobile/
  android/
    (Android shell project files)
docs/
  12-android-app-plan.md
```

## Definition of Done

1. User installs Android app from internal track.
2. User logs in and can navigate core task/session flows.
3. App receives live updates and supports terminal interactions.
4. Auth token is persisted securely across restarts.
5. Shared frontend code remains single-source with web.
