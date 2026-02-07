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

# Deploy to production server
deploy:
    ssh codeburg-server '/opt/codeburg/deploy/deploy.sh'

# Commit, push, and deploy in one shot
yeet msg:
    git add -A
    git commit -m "{{msg}}"
    git push
    just deploy
