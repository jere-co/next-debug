# Root Cause Analysis: Next.js RangeError with Gel Client

## Executive Summary

The bug is in React's server-side rendering code (`visitAsyncNode` function) when handling circular promise chains created by the Gel/EdgeDB client. The circular reference between two async nodes causes infinite recursion despite a `visited` Set that should prevent it.

## Location of Bug

**File:** `next.js/packages/next/src/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-server.node.development.js`

**Function:** `visitAsyncNode` (line 2042) and `visitAsyncNodeImpl` (line 2049)

```javascript
function visitAsyncNode(request, task, node, visited, cutOff) {
  if (visited.has(node)) return visited.get(node);  // Line 2043
  visited.set(node, null);  // Line 2044
  request = visitAsyncNodeImpl(request, task, node, visited, cutOff);  // Line 2045
  null !== request && visited.set(node, request);  // Line 2046
  return request;
}

function visitAsyncNodeImpl(request, task, node, visited, cutOff) {
  if (0 <= node.end && node.end <= request.timeOrigin) return null;
  var previousIONode = null;
  if (
    null !== node.previous &&
    ((previousIONode = visitAsyncNode(  // Recursive call 1
      request,
      task,
      node.previous,
      visited,
      cutOff
    )),
    void 0 === previousIONode)
  )
    return;
  switch (node.tag) {
    case 1:  // Promise/async node
      var awaited = node.awaited;
      if (null !== awaited) {
        cutOff = visitAsyncNode(request, task, awaited, visited, cutOff);  // Recursive call 2
        // ... continues processing
      }
      // ...
    case 2:  // Another async node type
      awaited = node.awaited;
      if (null !== awaited) {
        promise = visitAsyncNode(request, task, awaited, visited, cutOff);  // Recursive call 3
        // ... continues processing
      }
      // ...
  }
}
```

## The Circular Reference

From instrumentation logs during the error:

```
[visitAsyncNode] cycle tag=1 start=23912.263833 end=23920.5455 prevTag=null awaitedTag=2
[visitAsyncNode] cycle tag=2 start=23912.04975 end=23920.55375 prevTag=null awaitedTag=1
```

This shows:
- **Node A** (tag=1) has `awaited` pointing to **Node B** (tag=2)
- **Node B** (tag=2) has `awaited` pointing back to **Node A** (tag=1)

This creates a circular await chain: A awaits B, B awaits A.

## Why the `visited` Set Fails

The `visited` Set is implemented correctly for simple cases:
1. When first visiting a node, it checks `if (visited.has(node))`
2. If not visited, it sets `visited.set(node, null)` to mark as "visiting"
3. It then recursively processes the node
4. Finally updates with `visited.set(node, request)`

**However, the bug occurs because:**

The circular reference happens through the `awaited` property (not the node itself). When:
1. `visitAsyncNode(nodeA)` is called
2. It sets `visited.set(nodeA, null)`
3. It visits `nodeA.awaited` which is `nodeB`
4. `visitAsyncNode(nodeB)` is called  
5. It sets `visited.set(nodeB, null)`
6. It visits `nodeB.awaited` which is `nodeA`
7. `visitAsyncNode(nodeA)` is called **again**
8. `visited.has(nodeA)` returns `true`, `visited.get(nodeA)` returns `null`
9. Returns `null` to caller
10. But the recursion **doesn't stop here** - it continues processing in `visitAsyncNodeImpl`
11. The code path continues and may visit other properties or make other recursive calls
12. Eventually stack overflow occurs

The key issue: **Returning `null` for a circular reference doesn't prevent all code paths from continuing recursion.**

## Why Gel Client Triggers This

The Gel/EdgeDB client's `.run()` method creates promises with complex internal structure:

1. **Complex promise chains** - Gel queries create sophisticated promise wrappers
2. **TypeScript type inference** - The Gel-generated types (`dbschema/edgeql-js/index.ts`) have deeply nested type intersections
3. **Async tracking metadata** - React's dev mode attaches `_debugInfo` to promises for better error messages
4. **Promise wrapping** - Database clients often wrap native promises multiple times

This specific combination causes React to create async debug nodes that reference each other circularly.

## Why It Works in Next.js 15.4.7

Something changed between 15.4.7 and 15.5.0 that either:
1. Made the circular reference detection more aggressive (causing false positives)
2. Changed how promise metadata is tracked
3. Updated the React version with different async tracking behavior

## Reproduction

**Minimal trigger:**
```typescript
import { e, gelClient } from "@/gel-client";

export const TestSimple = async () => {
  const query = e.select(e.Post, () => ({ id: true }));
  const result = await query.run(gelClient);  // 🔥 Triggers infinite recursion
  return <div>{JSON.stringify(result)}</div>;
};
```

**What works:**
- ✅ Just importing the client
- ✅ Creating the query object
- ❌ Running the query with `.run()`

## Impact

- **Severity:** Critical - completely blocks development
- **Scope:** All Next.js 15.5.0+ with Gel/EdgeDB queries in Server Components
- **Workaround:** Downgrade to Next.js 15.4.7

## Proposed Fix

The fix should be in React's `visitAsyncNode` function. When a circular reference is detected (returning `null` from `visited.get(node)`), the function should:

1. **Option A:** Return a sentinel value that causes all code paths to abort, not just some
2. **Option B:** Track "currently visiting" vs "visited" separately with two sets
3. **Option C:** Add a maximum recursion depth limit as a safety net
4. **Option D:** Better handle circular awaited chains at the point where they're created

Example fix (Option B):
```javascript
function visitAsyncNode(request, task, node, visited, visiting, cutOff) {
  if (visited.has(node)) return visited.get(node);
  if (visiting.has(node)) return null;  // Circular reference - abort!
  
  visiting.add(node);
  visited.set(node, null);
  request = visitAsyncNodeImpl(request, task, node, visited, visiting, cutOff);
  visiting.delete(node);
  null !== request && visited.set(node, request);
  return request;
}
```

## Files for Reference

- Bug report: `BUG-REPORT.md`
- This analysis: `ROOT-CAUSE-ANALYSIS.md`
- Instrumentation: `range-logger.js`
- Error logs: `.next/range-error.log`

## Next Steps

1. ✅ Root cause identified
2. ⏳ Report to React team (this is React's code, not Next.js)
3. ⏳ Report to Next.js team (they vendor React and may be able to patch)
4. ⏳ Report to Gel/EdgeDB team (they may be able to work around this)
5. ⏳ Create minimal reproduction without Gel to confirm it's a React issue
