# Deployment Architecture

## Overview

Codeburg runs as a single Go binary on a Debian 12 VM in Proxmox. External access is provided by a Cloudflare named tunnel — no reverse proxy, no TLS configuration on the server.

```
Internet
    │
    ▼ HTTPS
┌──────────────────────────┐
│  Cloudflare Edge         │
│  codeburg.miscellanics.com │
└──────────┬───────────────┘
           │ Encrypted tunnel (outbound from VM)
           ▼
┌──────────────────────────┐
│  Proxmox VM (Debian 12)  │
│                          │
│  cloudflared ──► :8080   │
│                  │       │
│            codeburg      │
│            (Go binary)   │
│                  │       │
│        ┌────────┼────────┐
│        │        │        │
│      tmux    SQLite    git │
│    (sessions) (data)  (worktrees)
└──────────────────────────┘
```

## Components

### Codeburg Service

- **Binary**: `/opt/codeburg/backend/codeburg`
- **Command**: `codeburg serve --host 127.0.0.1 --port 8080`
- **Managed by**: systemd (`codeburg.service`)
- **Listens on**: `127.0.0.1:8080` (localhost only, cloudflared handles external access)

The Go binary serves both the API (`/api/*`, `/ws`) and the frontend static files (`frontend/dist/`).

### Cloudflare Tunnel

- **Service**: cloudflared (systemd-managed)
- **Type**: Named tunnel (persistent, not quick tunnel)
- **Route**: `codeburg.miscellanics.com` → `http://127.0.0.1:8080`
- **Config**: `/home/codeburg/.cloudflared/config.yml`

This is separate from the per-task quick tunnels that Codeburg creates for dev servers. Those use `cloudflared tunnel --url` and generate random `*.trycloudflare.com` URLs.

### Data Storage

All runtime data lives under `/home/codeburg/.codeburg/`:

| Path | Content |
|------|---------|
| `codeburg.db` | SQLite database (WAL mode) |
| `config.yaml` | Password hash |
| `.jwt_secret` | JWT signing key |
| `worktrees/` | Git worktrees (one per active task) |
| `logs/sessions/` | Session logs (JSONL files) |

### System User

The `codeburg` user owns all data and runs the service. It has limited sudo access for `systemctl` commands only (to allow the deploy script to restart the service).

## VM Resources

| Resource | Allocation |
|----------|-----------|
| OS | Debian 12 (Bookworm) |
| CPU | 2 cores |
| RAM | 4 GB |
| Disk | 30 GB |

These are generous for a personal tool. Codeburg itself uses ~50-100MB RAM. The extra headroom is for build toolchains (Go, Node.js) and agent sessions.

## Upgrade Process

From the dev machine:

```bash
just deploy
```

This SSHs into the server and runs `/opt/codeburg/deploy/deploy.sh`, which:

1. `git pull origin main`
2. Installs frontend dependencies (`pnpm install --frozen-lockfile`)
3. Builds frontend (`pnpm build`)
4. Builds backend (`go build`)
5. Runs migrations
6. Restarts the systemd service

Zero-downtime is not a goal (personal tool, restarts take <2 seconds).

## Security

- **No ports exposed**: The VM has no open ports. All traffic flows through the Cloudflare tunnel (outbound connection from VM).
- **HTTPS**: Terminated at Cloudflare's edge. The tunnel encrypts traffic between Cloudflare and the VM.
- **Auth**: bcrypt password hash + JWT tokens (7-day expiry).
- **CORS**: Only allows `https://codeburg.miscellanics.com` and `http://localhost:*`.
- **Systemd hardening**: `NoNewPrivileges`, `ProtectSystem=strict`, limited `ReadWritePaths`.

## Quick Tunnels (Dev Servers)

When working on tasks, Codeburg can expose local dev server ports via quick tunnels. These are independent from the named tunnel:

- Created per-task via the Codeburg UI
- Use `cloudflared tunnel --url http://localhost:<port>`
- Generate random `*.trycloudflare.com` URLs
- No Cloudflare account configuration needed
- Killed when the tunnel is stopped or the task is cleaned up
