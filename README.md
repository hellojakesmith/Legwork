# Legwork

Legwork is a focused autonomous task platform for browser-heavy digital work, with a controlled self-improvement layer that can observe runs, propose changes, create branches, and open draft pull requests.

## Run locally

1. Install dependencies: `npm install`
2. Install Playwright browsers: `npx playwright install chromium`
3. Start the app: `npm run dev`
4. Open `http://127.0.0.1:5173`

## Useful scripts

- `npm run dev` - start the API server and web UI
- `npm run test` - run unit tests
- `npm run typecheck` - run TypeScript checks
- `npm run build` - build the frontend and server type output

## Storage

Runtime data is stored locally in `.legwork/`:

- `.legwork/runs/` - execution history and checkpoints
- `.legwork/workflows/` - reusable workflow definitions
- `.legwork/proposals/` - improvement proposals
- `.legwork/artifacts/` - browser screenshots and artifacts

## What is implemented

- Deterministic planner that turns a goal into a step plan
- Playwright browser agent with retry/recovery behavior
- Resumable execution engine with approval gates and event logs
- File-backed run history and workflow saving
- Controlled improvement foundation with internal agent definitions and PR creation hooks
- React dashboard for planning, running, and browsing history

## What is still missing

- LLM-driven planning and step synthesis
- Rich spreadsheet export and report generation
- Persistent queueing and concurrent run management
- Deeper browser intelligence for site-specific flows
- Automated branch implementation generation for improvement proposals

