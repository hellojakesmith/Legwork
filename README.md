# Legwork

Legwork is a focused autonomous personal virtual assistant for browser-heavy digital work, with a controlled self-improvement layer that can observe runs, propose changes, create branches, and open draft pull requests.

## Run locally

1. Install dependencies: `npm install`
2. Install Playwright browsers: `npx playwright install chromium`
3. Optionally set `OPENAI_API_KEY` if you want LLM-assisted planning.
4. Start the app: `npm run dev`
5. Open `http://127.0.0.1:5173`

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

Runtime credentials are not written to disk. They live only in memory through the credential session API.

## Safe credential flow

1. Enter credentials in the UI and create a runtime credential session.
2. Copy or keep the returned session id in the current browser session.
3. Start a run with that session id and the relevant goal/context.
4. Approve login or irreversible actions when prompted.
5. Resume paused runs from the UI.

The app never stores raw secrets in `.legwork/` or in the repository. If the server process restarts, runtime credential sessions are lost and must be recreated.

## What is implemented

- Deterministic planner that turns a goal into a step plan
- Optional LLM-assisted planner when `OPENAI_API_KEY` is set
- Playwright browser agent with retry/recovery behavior
- Login support, structured extraction, uploads, checkbox/select controls, and challenge detection
- Detached execution loop with live polling, approval gates, event logs, screenshot artifacts, and final run summary artifacts
- File-backed run history and workflow saving
- Controlled improvement foundation with internal agent definitions and PR creation hooks
- React product UI centered on goal entry, task review, live execution, and final results
- Fresh planning from the current goal/context before review or execution, so the visible task list stays aligned with what will run

## What is still missing

- Rich spreadsheet export and report generation
- Persistent queueing and concurrent run management
- Deeper browser intelligence for site-specific flows
- Durable secret storage for long-lived credentials
- Automated branch implementation generation for improvement proposals
- More granular workflow parameterization and replay
