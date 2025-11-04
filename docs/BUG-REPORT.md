# Next.js Bug Report: RangeError Maximum Call Stack Size Exceeded

## Summary

Next.js 15.5.0+ crashes with `RangeError: Maximum call stack size exceeded` during dev mode SSR when rendering async Server Components that call `.run()` on EdgeDB/Gel client queries.

- **Affected versions:** Next.js 15.5.0, 15.5.6, 16.0.1, 16.0.2-canary.1  
- **Working version:** Next.js 15.4.7
- **Affects:** Both Turbopack (default in 16.x) and webpack
- **Environment:** Dev mode only - production builds work

## Root Cause

The error occurs in Next.js's `visitAsyncNode` function during Server-Side Rendering of async components. The function enters infinite recursion when processing promises returned by the Gel client's `.run()` method.

### Error Location
- **Turbopack**: Causes panic in `turbopack/crates/turbo-tasks-backend/src/backend/operation/aggregation_update.rs:1420:17`
- **Webpack**: `RangeError` at `visitAsyncNode` in `next/dist/compiled/next-server/app-page.runtime.dev.js:25:98656`

## Reproduction

### Minimal Test Case

**Works ✅:**
```typescript
// Just importing e
import { e } from "@/gel-client";
```

**Works ✅:**
```typescript
// Creating a query
import { e } from "@/gel-client";
const query = e.select(e.Post, () => ({ id: true }));
```

**FAILS ❌:**
```typescript
// Running the query
import { e, gelClient } from "@/gel-client";
const query = e.select(e.Post, () => ({ id: true }));
const result = await query.run(gelClient); // 🔥 Triggers RangeError
```

### Full Reproduction

Repository: `/Users/jere/Code/@riffrafffilms/next-debug`

```bash
# Install dependencies
pnpm install

# Run with webpack (shows RangeError)
pnpm dev --webpack
# Visit http://localhost:3000

# Run with Turbopack (shows panic)
pnpm dev  
# Visit http://localhost:3000
```

**Files:**
- `app/page.tsx` - Main page with Suspense boundary
- `app/test-simple.tsx` - Minimal async Server Component
- `gel-client.ts` - EdgeDB/Gel client initialization
- `dbschema/edgeql-js/index.ts` - Gel-generated types (complex TypeScript types)

## Stack Traces

### Webpack Error
```
RangeError: Maximum call stack size exceeded
    at visitAsyncNode (.../next/dist/compiled/next-server/app-page.runtime.dev.js:25:98656)
    at visitAsyncNode (.../next/dist/compiled/next-server/app-page.runtime.dev.js:25:98861)
    [... repeats indefinitely]
```

### Turbopack Error
```
thread 'tokio-runtime-worker' panicked at turbopack/crates/turbo-tasks-backend/src/backend/operation/aggregation_update.rs:1420:17:
inner_of_uppers_lost_follower is not able to remove follower TaskId 17 (ProjectContainer::entrypoints) 
from TaskId 16 (EntrypointsOperation::new) as they don't exist as upper or follower edges
```

## Investigation Findings

1. **Not a Babel issue** - Initially suspected Babel AST processing, but the error actually occurs in Next.js's async component tracking system

2. **Circular dependency detected** - Custom instrumentation showed circular promises awaiting each other:
   ```
   [visitAsyncNode] cycle tag=1 awaitedTag=2
   [visitAsyncNode] cycle tag=2 awaitedTag=1
   ```

3. **Gel query characteristics** - The Gel client returns a promise that might have complex internal structure or prototype chain that confuses Next.js's async tracking

4. **Dev-only issue** - Production builds complete successfully, suggesting the issue is in the development-mode async tracking instrumentation

## Environment

- **OS:** macOS (Darwin 25.1.0)
- **Node.js:** v20+
- **Package manager:** pnpm 10.20.0
- **Next.js:** 16.0.1 (broken), 15.4.7 (works)
- **React:** 19.2.0
- **Gel (EdgeDB client):** 2.1.1

## Expected Behavior

The async Server Component should render successfully with the data fetched from the database, just as it does in Next.js 15.4.7.

## Actual Behavior

- **Webpack:** Server hangs for 15+ seconds, eventually returns HTTP 200 but with unhandled RangeError rejections
- **Turbopack:** Server panics with task graph corruption error

## Workaround

Downgrade to Next.js 15.4.7:
```json
{
  "dependencies": {
    "next": "15.4.7"
  }
}
```

## Additional Context

This appears to be a regression introduced between Next.js 15.4.7 and 15.5.0, likely related to changes in how async components or promises are tracked during SSR. The specific interaction with Gel client's promise structure triggers infinite recursion in `visitAsyncNode`.

## Debugging Files Created

- `range-logger.js` - Preload script to capture RangeError stacks
- `.next/range-error.log` - Captured error logs
- Custom instrumentation in Next.js source to trace async cycles

## Next Steps

1. Identify what changed in `visitAsyncNode` or async tracking between 15.4.7 and 15.5.0
2. Determine why Gel client promises trigger infinite recursion
3. Add safeguards to prevent infinite recursion in async tracking
4. Consider if this affects other ORM/database clients with complex promise chains
