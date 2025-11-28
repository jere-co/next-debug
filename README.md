# Next.js + React visitAsyncNode Bug Fix

This repository reproduces and **fixes** a dev-mode `RangeError: Maximum call stack size exceeded` caused by React's `visitAsyncNode` implementation when using database clients like Gel/EdgeDB.

## The Bug

**Affected versions:** Next.js 15.5.0+ with React 19.2.0+  
**Status:** Fix implemented, pending PR to React

When async Server Components call database queries (e.g., Gel's `.run()` method), React's dev-mode async tracking can enter infinite recursion due to circular promise chains.

## Quick Fix for Your Project

Copy `patch-visitAsyncNode.js` to your project and add to `package.json`:

```json
{
  "scripts": {
    "postinstall": "node patch-visitAsyncNode.js"
  }
}
```

Then run `pnpm install` (or npm/yarn). The patch auto-applies after each install.

### Manual Usage

```bash
# Apply the patch
node patch-visitAsyncNode.js

# Restore original files
node patch-visitAsyncNode.js --restore
```

## Quick Start (This Repo)

```bash
pnpm install    # Automatically applies the patch via postinstall
pnpm dev        # Start dev server
```

Visit [http://localhost:3000](http://localhost:3000) - the page should render without RangeError.

## The Fix

The bug is in React's `visitAsyncNode` function which:
1. Uses `null` as both "currently visiting" and a valid cached result
2. Doesn't cache `undefined` results
3. Causes infinite recursion with circular async node references

**Solution:** Use an `IN_PROGRESS` sentinel symbol and always cache results:

```javascript
var IN_PROGRESS = Symbol.for("react.asyncTraversal.inProgress");

function visitAsyncNode(request, task, node, visited, cutOff) {
  if (visited.has(node)) {
    var memo = visited.get(node);
    if (memo === IN_PROGRESS) return void 0;  // Cycle detected
    return memo;
  }
  visited.set(node, IN_PROGRESS);
  var result = visitAsyncNodeImpl(request, task, node, visited, cutOff);
  visited.set(node, result);  // Always cache
  return result;
}
```

## Repository Layout

```
patch-visitAsyncNode.js  - Reusable patch script (copy to your project)
react/                   - React source with fix applied
docs/                    - Background analysis and bug reports
  BUG-REPORT.md
  ROOT-CAUSE-ANALYSIS.md
  FINAL-ANALYSIS.md
range-logger.js          - Debug script to capture RangeError stacks
instrumented.js          - Instrumented runtime with logging
```

## PR to React

The fix has been implemented in `react/packages/react-server/src/ReactFlightServer.js`.

To submit the PR:
1. The fix is in the local `react/` directory
2. Changes are minimal: ~24 lines changed in one file
3. See `docs/` for full analysis and reproduction steps

## Debugging Tools

If you want to investigate further:

```bash
# Use instrumented runtime with logging
cp instrumented.js node_modules/next/dist/server/app-page-turbo.runtime.dev.js

# Check error logs
cat .next/range-error.log
```

The `range-logger.js` preload captures RangeError stacks to `.next/range-error.log`.
