# Codeburg task runner

export GOTOOLCHAIN := "auto"

# List available recipes
default:
    @just --list

# --- Development ---

# Start frontend dev server (port 3000, proxies to :8080)
dev-fe:
    pnpm --dir frontend dev

# Start macOS shell in dev mode (expects frontend dev server to already be running)
dev-macos:
    pnpm --dir desktop/macos dev

# Start backend dev server (port 8080)
dev-be:
    cd backend && go run ./cmd/codeburg serve

# --- Build ---

# Build everything (frontend + backend)
build: build-fe build-be

# Build frontend assets for macOS desktop shell
build-macos-fe:
    pnpm --dir desktop/macos build:frontend

# Build local macOS shell assets (icon + frontend dist)
build-macos:
    pnpm --dir desktop/macos build:icon
    pnpm --dir desktop/macos build:frontend

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

# Run macOS shell against built frontend assets (optional `origin` override)
start-macos origin="":
    if [ -n "{{origin}}" ]; then CODEBURG_SERVER_ORIGIN="{{origin}}" pnpm --dir desktop/macos start; else pnpm --dir desktop/macos start; fi

# Run macOS shell against the production server
start-macos-prod:
    CODEBURG_SERVER_ORIGIN="https://codeburg.miscellanics.com" pnpm --dir desktop/macos start

# Build and run macOS shell against the production server
run-macos-prod:
    just build-macos
    CODEBURG_SERVER_ORIGIN="https://codeburg.miscellanics.com" pnpm --dir desktop/macos start

# Build distributable macOS desktop artifacts
dist-macos:
    pnpm --dir desktop/macos dist

# --- Database ---

# Run database migrations
migrate:
    cd backend && go run ./cmd/codeburg migrate

# --- Lint ---

# Lint frontend
lint-fe:
    pnpm --dir frontend lint

# Check server runtime/tooling requirements for developing Codeburg from within Codeburg
check-runtime:
    ./deploy/check-runtime-tooling.sh

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

# Deploy the server from the current checkout/ref (safe for running inside Codeburg sessions)
deploy-self ref="HEAD":
    ./deploy/deploy-self.sh "{{ref}}" "$(pwd)"

# Deploy frontend only from the current checkout/ref (safe for running inside Codeburg sessions)
deploy-self-fe ref="HEAD":
    ./deploy/deploy-self-fe.sh "{{ref}}" "$(pwd)"

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
