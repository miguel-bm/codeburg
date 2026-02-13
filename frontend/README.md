# Codeburg Frontend

React + TypeScript frontend for Codeburg.

## Dev Server

From `frontend/`:

```bash
pnpm install
pnpm dev
```

Vite runs on `http://localhost:3000` and proxies:

- `/api` -> `http://localhost:8080`
- `/ws` -> `ws://localhost:8080`

## Scripts

```bash
pnpm dev        # start Vite dev server
pnpm test       # run Vitest once
pnpm test:watch # watch mode
pnpm lint       # eslint
pnpm build      # typecheck + production build
pnpm preview    # preview built app
```

## Testing Notes

- Test runner: Vitest + jsdom
- UI tests: @testing-library/react
- Global setup: `src/test/setup.ts`
