# Deployment Guide: From Proxmox to Running

Step-by-step guide to deploy Codeburg on a Proxmox home server.

## Prerequisites

On your dev machine you need:
- SSH key pair (`~/.ssh/id_ed25519` or similar)
- Access to your Proxmox web UI
- Access to Cloudflare dashboard (miscellanics.com)

## Step 1: Create the VM in Proxmox

1. Download the Debian 12 (Bookworm) ISO from https://www.debian.org/download
2. Upload it to Proxmox storage (local → ISO Images → Upload)
3. Create a new VM:
   - **General**: Name `codeburg`, Start at boot: Yes
   - **OS**: Select the Debian 12 ISO
   - **System**: Default (BIOS or UEFI, either works)
   - **Disk**: 30 GB, VirtIO Block
   - **CPU**: 2 cores
   - **Memory**: 4096 MB
   - **Network**: Bridge `vmbr0` (or your LAN bridge), VirtIO

4. Start the VM and go through Debian installer:
   - Language/locale: your preference
   - Hostname: `codeburg`
   - Root password: set one (needed for setup)
   - Create a regular user (any name, this is temporary — we'll use the `codeburg` user later)
   - Partitioning: Guided, use entire disk
   - Software selection: **only** SSH server + standard system utilities (no desktop)

5. After install, note the VM's IP address:
   ```bash
   ip addr show
   ```

6. From your dev machine, verify SSH works:
   ```bash
   ssh root@<VM_IP>
   ```
   
## Step 2: Run the Setup Script

SSH into the VM and run the setup script as root. Two options depending on repo visibility:

```bash
# Option A: If the repo is public
sudo bash -c "curl -sSL https://raw.githubusercontent.com/miguel-bm/codeburg/main/deploy/setup.sh | bash"

# Option B: If the repo is private, copy the script from your dev machine first:
#   (from dev machine) scp deploy/setup.sh root@<VM_IP>:/root/setup.sh
#   (on VM)            sudo bash /root/setup.sh
```

The setup script installs everything: Go, Node.js, pnpm, tmux, just, cloudflared, creates the `codeburg` user, builds the project, and starts the systemd service.

**Note:** The build happens on the server (Linux amd64). Do not commit locally-built binaries — `backend/codeburg` is in `.gitignore`.

When it finishes, verify Codeburg is running:

```bash
systemctl status codeburg
curl http://127.0.0.1:8080/api/auth/status
# Should return: {"setup":false}
```

## Step 3: Set Up SSH Key Access

From your **dev machine**:

```bash
# Copy your SSH key to the codeburg user
ssh-copy-id codeburg@<VM_IP>

# Verify passwordless login
ssh codeburg@<VM_IP> whoami
# Should print: codeburg
```

Add to your `~/.ssh/config`:

```
Host codeburg-server
    HostName <VM_IP>
    User codeburg
```

Now you can connect with just `ssh codeburg-server`.

## Step 4: Configure the Cloudflare Tunnel

On the VM, as the `codeburg` user:

```bash
su - codeburg
# or: ssh codeburg-server
```

### 4a. Authenticate with Cloudflare

```bash
cloudflared tunnel login
```

This opens a URL — copy it to your browser, select the `miscellanics.com` zone, and authorize. A certificate is saved to `~/.cloudflared/cert.pem`.

### 4b. Create the Tunnel

```bash
cloudflared tunnel create codeburg
```

This outputs something like:
```
Created tunnel codeburg with id abc123-def456-...
```

Note the tunnel ID.

### 4c. Configure the Tunnel

```bash
cp /opt/codeburg/deploy/cloudflared.yml ~/.cloudflared/config.yml
```

Edit `~/.cloudflared/config.yml` and replace both instances of `<TUNNEL_ID>` with the actual ID:

```bash
nano ~/.cloudflared/config.yml
```

### 4d. Add DNS Route

```bash
cloudflared tunnel route dns codeburg codeburg.miscellanics.com
```

This creates a CNAME record in Cloudflare DNS pointing `codeburg.miscellanics.com` to the tunnel.

### 4e. Test the Tunnel Manually

```bash
cloudflared tunnel run codeburg
```

Open `https://codeburg.miscellanics.com` in your browser — you should see the Codeburg setup page. Press Ctrl+C to stop.

### 4f. Install as System Service

The cloudflared system service looks for config in `/etc/cloudflared/`, not the codeburg user's home. Copy the config and credentials there, then install the service as root:

```bash
# Exit codeburg user back to your admin user
exit

# As root (su - or sudo):
su -

# Copy tunnel config and credentials to system location
mkdir -p /etc/cloudflared
cp /home/codeburg/.cloudflared/config.yml /etc/cloudflared/config.yml
cp /home/codeburg/.cloudflared/*.json /etc/cloudflared/

# Update credentials path in system config to match new location
sed -i 's|/home/codeburg/.cloudflared/|/etc/cloudflared/|g' /etc/cloudflared/config.yml

# Install and start
cloudflared service install
systemctl enable cloudflared
systemctl start cloudflared
```

Verify:

```bash
systemctl status cloudflared
curl https://codeburg.miscellanics.com/api/auth/status
```

## Step 5: Initial Codeburg Setup

1. Open `https://codeburg.miscellanics.com` in your browser
2. Set your password on the setup screen
3. Log in
4. Create your first project

## Step 6: Configure Deployments from Dev Machine

On your **dev machine**, verify the deploy command works:

```bash
cd /path/to/codeburg
just deploy
```

This should SSH into the server, pull, build, and restart. You're done!

## Ongoing Operations

### Deploy Updates

```bash
just deploy
```

### Check Server Status

```bash
ssh codeburg-server 'sudo systemctl status codeburg'
```

### View Server Logs

```bash
ssh codeburg-server 'sudo journalctl -u codeburg -f'
```

### View Tunnel Logs

```bash
ssh codeburg-server 'sudo journalctl -u cloudflared -f'
```

### Restart Services

The `codeburg` user has passwordless sudo for `systemctl` commands on the codeburg service:

```bash
ssh codeburg-server 'sudo systemctl restart codeburg'
```

For cloudflared, you'll need root access:

```bash
ssh root@<VM_IP> 'systemctl restart cloudflared'
```

### Backup Database

```bash
ssh codeburg-server 'cp ~/.codeburg/codeburg.db ~/.codeburg/codeburg.db.bak'
# Or pull it locally:
scp codeburg-server:~/.codeburg/codeburg.db ./codeburg-backup.db
```

### Reset Password

If you forget your password, delete the config on the server:

```bash
ssh codeburg-server 'rm ~/.codeburg/config.yaml && sudo systemctl restart codeburg'
```

Then visit the site again to set a new password.

## Troubleshooting

### Codeburg won't start

```bash
ssh codeburg-server 'journalctl -u codeburg -n 50 --no-pager'
```

Common causes:
- Port 8080 already in use
- Database file permissions
- Missing `~/.codeburg/` directory

### Tunnel not connecting

```bash
ssh codeburg-server 'journalctl -u cloudflared -n 50 --no-pager'
```

Common causes:
- Invalid tunnel ID in config
- Certificate expired (re-run `cloudflared tunnel login`)
- DNS route not configured

### Terminal sessions not working

tmux must be available in the codeburg user's session:

```bash
ssh codeburg-server 'tmux list-sessions'
```

If tmux isn't running, Codeburg will create sessions on demand.

### Build fails during deploy

```bash
# Check Go version
ssh codeburg-server 'go version'

# Check Node version
ssh codeburg-server 'node --version'

# Check pnpm
ssh codeburg-server 'pnpm --version'

# Manual build for debugging
ssh codeburg-server 'cd /opt/codeburg && just build'
```
