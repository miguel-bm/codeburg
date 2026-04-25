# Paseo Trial Alongside Codeburg

This is the lowest-risk way to try Paseo on the same remote machine as Codeburg.

## Trial shape

- install under the existing `codeburg` user
- isolate state in `~/.paseo-trial`
- listen on `127.0.0.1:6767`
- keep Codeburg unchanged on `127.0.0.1:8080`
- use Paseo relay pairing or the official web app/desktop app for access

This avoids:

- touching system users
- touching systemd units
- changing reverse proxy routes
- risking collisions with Codeburg state

## Remote install

Run as the `codeburg` user on the remote machine:

```bash
cd /opt/codeburg
PASEO_HOME=/home/codeburg/.paseo-trial \
PASEO_PORT=6767 \
./deploy/paseo-trial-install.sh
```

## Access

After install, fetch a pairing link:

```bash
ssh codeburg-server 'bash -lc "
  export PATH=\$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin
  PASEO_HOME=/home/codeburg/.paseo-trial paseo daemon pair --home /home/codeburg/.paseo-trial
"'
```

Then open one of:

- desktop app
- mobile app
- `https://app.paseo.sh`

and scan/paste the pairing offer.

## Notes

- Paseo state lives under `~/.paseo-trial`
- Codeburg state remains under `~/.codeburg`
- both tools can point at the same repositories
- safest usage is letting each tool manage its own worktrees
