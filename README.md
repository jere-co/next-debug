# Next.js + React visitAsyncNode Bug Reproduction & Fix

This repository reproduces and fixes a dev-mode `RangeError: Maximum call stack size exceeded` caused by React's `visitAsyncNode` function when using database clients like Gel/EdgeDB.

## The Bug

**Affected versions:** Next.js 16.0.7+ with React 19.2.0+

When async Server Components call database queries (e.g., Gel's `.run()` method), React's dev-mode async tracking enters infinite recursion due to circular promise chains.

## Reproduce the Bug

```bash
# 1. Clone and install
git clone https://github.com/jere-co/next-debug.git
cd next-debug
pnpm install --ignore-scripts   # Skip postinstall to NOT apply patch

# 2. Start dev server
pnpm dev

# 3. Visit http://localhost:3000
# You'll see: RangeError: Maximum call stack size exceeded
```

## Apply the Fix

```bash
# Apply the patch
node patch-visitAsyncNode.cjs

# Restart dev server
pnpm dev

# Visit http://localhost:3000 - page renders successfully
```

## Use the Patch in Your Project

1. Copy `patch-visitAsyncNode.cjs` to your project root
2. Add to `package.json`:

```json
{
  "scripts": {
    "postinstall": "node patch-visitAsyncNode.cjs"
  }
}
```

3. Run `pnpm install` (or npm/yarn)

The patch auto-applies after each install. To restore original files:

```bash
node patch-visitAsyncNode.cjs --restore
```

## The Root Cause

React's `visitAsyncNode` function uses `null` as both:
1. An "in progress" marker during traversal
2. A valid cached result

When circular async node references exist (common with database clients), revisiting a node returns `null` as if it were a cached result, causing infinite recursion.

## The Fix

Use an `IN_PROGRESS` sentinel Symbol and always cache results:

```javascript
const IN_PROGRESS = Symbol.for("react.asyncTraversal.inProgress");

function visitAsyncNode(request, task, node, visited, cutOff) {
  if (visited.has(node)) {
    const memo = visited.get(node);
    if (memo === IN_PROGRESS) return null;  // Cycle detected, no I/O on this path
    return memo;
  }
  visited.set(node, IN_PROGRESS);
  const result = visitAsyncNodeImpl(request, task, node, visited, cutOff);
  visited.set(node, result);  // Always cache
  return result;
}
```

Note: We return `null` (not `undefined`) on cycle detection because `undefined` signals "abort" semantics which would skip emitting I/O info for other non-cyclic branches.

## Repository Structure

```
patch-visitAsyncNode.cjs  - Reusable patch script (copy to your project)
PATCH-README.md           - Standalone docs for the patch script
react/                    - React fork with fix applied
docs/                     - Background analysis
  BUG-REPORT.md
  ROOT-CAUSE-ANALYSIS.md
  FINAL-ANALYSIS.md
```

## Related Issues

- https://github.com/vercel/next.js/issues/77065
- https://github.com/vercel/next.js/issues/78004
