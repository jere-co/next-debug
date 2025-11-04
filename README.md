This repository reproduces a dev-mode `RangeError: Maximum call stack size exceeded` that we traced back to React’s `visitAsyncNode` implementation. It also includes some lightweight tooling (`instrumented.js`, `range-logger.js`) to make debugging the failure easier.

## Quick Start

```bash
pnpm install

# Re-apply the Turbopack instrumentation after installing dependencies.
cp instrumented.js node_modules/next/dist/server/app-page-turbo.runtime.dev.js

# Start the dev server (the script already preloads range-logger.js).
pnpm dev
```

Once the app compiles, load [http://localhost:3000](http://localhost:3000). When the recursive promise cycle trips the bug you’ll see:

- `console.warn` output from `visitAsyncNode` every 1 000 recursive calls (these come from `instrumented.js`).
- A detailed stack trace appended to `.next/range-error.log` (written by `range-logger.js`).

If you reinstall `next`, re-run the `cp instrumented.js …` command above—the vendored runtime will be overwritten by npm.

## Repository Layout

- `instrumented.js` – patched Turbopack runtime with additional logging around `visitAsyncNode`.
- `range-logger.js` – preload script that captures RangeError stacks to `.next/range-error.log`.
- `docs/` – background write-ups (`BUG-REPORT.md`, `ROOT-CAUSE-ANALYSIS.md`, etc.).

## Typical Workflow for Collaborators

1. Install dependencies and apply the instrumentation (see **Quick Start**).
2. Run `pnpm dev` to reproduce the failure locally (the script already injects the preload).
3. Tail `.next/range-error.log` and the terminal output to correlate the high call-count with the captured stack.
