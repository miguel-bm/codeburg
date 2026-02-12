# Codeburg task runner

export GOTOOLCHAIN := "auto"

# List available recipes
default:
    @just --list

# --- Development ---

# Start frontend dev server (port 3000, proxies to :8080)
dev-fe:
    pnpm --dir frontend dev

# Start backend dev server (port 8080)
dev-be:
    cd backend && go run ./cmd/codeburg serve

# --- Build ---

# Build everything (frontend + backend)
build: build-fe build-be

# Build frontend to dist/
build-fe:
    cd frontend && pnpm build

# Build backend binary
build-be:
    cd backend && go build -o codeburg ./cmd/codeburg

# --- Test ---

# Run all tests
test: test-be test-fe

# Run backend tests
test-be:
    cd backend && go test ./...

# Run frontend tests
test-fe:
    pnpm --dir frontend test

# Run frontend tests in watch mode
test-fe-watch:
    pnpm --dir frontend test:watch

# --- Database ---

# Run database migrations
migrate:
    cd backend && go run ./cmd/codeburg migrate

# --- Lint ---

# Lint frontend
lint-fe:
    pnpm --dir frontend lint

# --- Deploy ---

# Deploy to production server (optionally specify branch, default: main)
deploy branch="main":
    ssh codeburg-server '/opt/codeburg/deploy/deploy.sh {{branch}}'

# Deploy frontend only (no server restart, sessions stay alive)
deploy-fe branch="main":
    ssh codeburg-server '/opt/codeburg/deploy/deploy-fe.sh {{branch}}'

# Deploy after a clean slate (full restart, kills active sessions)
deploy-clean branch="main":
    ssh codeburg-server '/opt/codeburg/deploy/deploy.sh {{branch}}'

# Commit, push, and deploy in one shot (uses current branch)
yeet msg:
    git add -A
    git commit -m "{{msg}}"
    git push -u origin "$(git branch --show-current)"
    just deploy "$(git branch --show-current)"

# Commit, push, and deploy frontend only (sessions stay alive)
yeet-fe msg:
    git add -A
    git commit -m "{{msg}}"
    git push -u origin "$(git branch --show-current)"
    just deploy-fe "$(git branch --show-current)"

# Amend, force push, and deploy frontend only (sessions stay alive)
stomp-fe:
    git add -A
    git commit --amend --no-edit
    git push --force-with-lease -u origin "$(git branch --show-current)"
    just deploy-fe "$(git branch --show-current)"

# Amend, force push, and deploy (no new commit)
stomp:
    git add -A
    git commit --amend --no-edit
    git push --force-with-lease -u origin "$(git branch --show-current)"
    just deploy "$(git branch --show-current)"
