# Critical Next.js Bug: RangeError Maximum Call Stack Size Exceeded

## Problem Statement

Next.js 15.5.0+ crashes with `RangeError: Maximum call stack size exceeded` during **dev mode compilation** when compiling pages that import from EdgeDB/Gel client with complex TypeScript type definitions.

**Works:** Next.js 15.4.7  
**Broken:** Next.js 15.5.0, 15.5.6, 16.0.1, 16.0.2-canary.1  
**Environment:** Dev mode only (not production builds), uses Turbopack by default in 16.x

## Error Details

```
RangeError: Maximum call stack size exceeded
    at ignore-listed frames
 ⨯ unhandledRejection: RangeError: Maximum call stack size exceeded
```

According to stack traces from debugging:
- `Set.has()` is called 10,000+ times recursively
- Occurs in Babel's `defineType` function during AST type definition
- Happens during page compilation, not at startup

## Reproduction

This repository (`/Users/jere/Code/@riffrafffilms/next-debug`) contains a minimal reproduction:

1. **App structure:**
   - `app/page.tsx` - Main page with async Server Component
   - `app/server.ts` - Imports from Gel client, triggers the bug
   - `gel-client.ts` - Exports EdgeDB/Gel client
   - `dbschema/edgeql-js/index.ts` - Gel-generated code with complex TypeScript types

2. **To reproduce:**
   ```bash
   cd /Users/jere/Code/@riffrafffilms/next-debug
   pnpm install
   pnpm dev  # Uses local Next.js from ./next.js
   # Visit http://localhost:3000
   # Observe RangeError during compilation
   ```

3. **Key code that triggers it:**
   ```typescript
   // app/server.ts
   import { e, gelClient } from "@/gel-client";
   
   export const getPosts = async () => {
     const query = e.select(e.Post, () => ({ id: true }));
     const result = await query.run(gelClient);
     return result;
   };
   ```

## What We've Tried (That DIDN'T Work)

### Attempt 1: Fix bundle.js config path
**Hypothesis:** Commit 3d5e456a92 changed `loadConfig` to `loadFullConfig` in get-config.ts, but bundle.js still pointed to wrong module.

**Changes Made:**
- Changed `packages/next/src/bundles/babel/bundle.js` line 11:
  ```javascript
  function coreLibConfig() {
    return require('@babel/core/lib/config/full')  // was: '@babel/core/lib/config'
  }
  ```
- Rebuilt babel bundle: `cd packages/next && pnpm taskr ncc_babel_bundle`

**Result:** ❌ RangeError still occurs

### Attempt 2: Revert to loadConfig
**Hypothesis:** Maybe `loadFullConfig` exposes the bug, revert to `loadConfig`.

**Changes Made:**
- Reverted `packages/next/src/build/babel/loader/get-config.ts` line 6:
  ```typescript
  import loadConfig from 'next/dist/compiled/babel/core-lib-config'  // was: loadFullConfig
  ```
- Reverted line 488:
  ```typescript
  const config = consumeIterator(loadConfig(loadedOptions));  // was: loadFullConfig
  ```
- Updated bundle.js back to `@babel/core/lib/config`
- Rebuilt babel bundle

**Result:** ❌ RangeError still occurs

### Attempt 3: Revert registerDeclaration change
**Hypothesis:** jsx-pragma.ts was changed to use `registerDeclaration` instead of manual `registerBinding` loop.

**Changes Made:**
- Reverted `packages/next/src/build/babel/plugins/jsx-pragma.ts` line 73:
  ```typescript
  // Changed from:
  path.scope.registerDeclaration(newPath)
  
  // Back to:
  for (const declar of newPath.get('declarations')) {
    path.scope.registerBinding(
      newPath.node.kind,
      declar as NodePath<BabelTypes.Node>
    )
  }
  ```
- Rebuilt babel bundle

**Result:** ❌ RangeError still occurs

### Attempt 4: Test with unmodified v15.5.0
**Changes Made:**
- Checked out commit 7e08c8223d (v15.5.0 release)
- No modifications
- Rebuilt and tested

**Result:** ❌ RangeError still occurs (confirming the bug exists in v15.5.0)

## Key Findings

1. **Commit 3d5e456a92 is NOT the cause** - Reverting ALL changes from this commit does not fix the issue
2. **The bug is dev-mode specific** - Only happens with `next dev`, not `next build`
3. **The bug is Turbopack-specific** - Next.js 16.x defaults to Turbopack in dev
4. **Complex TypeScript types trigger it** - Gel's generated code has complex type intersections and utility types
5. **The actual breaking commit is unknown** - It's somewhere between working 15.4.7 and broken 15.5.0

## Suspect Areas

### 1. Gel-Generated Code (Possible Root Cause)
File: `dbschema/edgeql-js/index.ts`

Contains:
- Complex type intersections: `typeof _std & typeof _default & $.util.OmitDollarPrefixed<typeof $syntax>`
- Multiple spread operators in object literal
- A type named `Set` which might conflict with JavaScript's built-in `Set`:
  ```typescript
  export type Set<
    Type extends $.BaseType,
    Card extends $.Cardinality = $.Cardinality.Many
  > = $.TypeSet<Type, Card>;
  ```

**Hypothesis:** Babel's type system encounters this `Set` type and gets confused with the built-in `Set` object it uses internally (`Set.has()`), causing infinite recursion.

### 2. Babel Type Upgrades in commit 3d5e456a92
While reverting the code changes didn't help, this commit also upgraded TypeScript type definitions:
- `@types/babel__core`: 7.1.12 → 7.20.5
- `@types/babel__generator`: 7.6.2 → 7.27.0
- `@types/babel__traverse`: 7.11.0 → 7.20.7

These are TypeScript types (not runtime), but they changed how Babel's internal types are defined.

### 3. React Version Upgrade
Between 15.4.x and 15.5.0, React was upgraded from `a96a0f39-20250815` to `0bdb9206-20250818`.

### 4. Turbopack Changes
Multiple Turbopack commits in that timeframe could affect how Babel is invoked in dev mode.

## Next Steps for Investigation

### Option 1: Git Bisect (Most Reliable)
```bash
cd /Users/jere/Code/@riffrafffilms/next-debug/next.js

# Find a known working commit before 15.5.0
# Then bisect between that and 7e08c8223d (v15.5.0)

git bisect start
git bisect bad 7e08c8223d  # v15.5.0 (broken)
git bisect good <WORKING_COMMIT>  # Find this first

# For each commit git checks out:
cd packages/next && pnpm taskr ncc_babel_bundle
cd /Users/jere/Code/@riffrafffilms/next-debug
rm -rf .next
PORT=3000 pnpm dev &
sleep 10
curl -s http://localhost:3000/ > /dev/null
# Check if RangeError appears in logs
# git bisect good/bad accordingly
```

### Option 2: Test the Gel Code Hypothesis
Try modifying `dbschema/edgeql-js/index.ts` to:
1. Rename the `Set` type to something else (e.g., `GelSet`)
2. Simplify the complex type intersections
3. Remove spread operators

See if any of these changes make the error go away.

### Option 3: Add Debugging to Babel
Instrument Babel's type system to log when it enters recursion:
- Add logging to `@babel/types` `defineType` function
- Track call stack depth
- Identify which specific type causes the recursion

### Option 4: Check if Fixed in Later Versions
Test with Next.js 16.0.3+ or latest canary to see if this was already fixed upstream.

## Current State (Reset for Fresh Investigation)

Both repositories have been reset to a clean state:

### Reproduction App (`/Users/jere/Code/@riffrafffilms/next-debug`)
- ✅ Reset to original state
- ✅ Using Next.js 15.4.7 from npm (working version)
- ✅ Clean .next cache removed
- ✅ All dev servers killed

To test with local Next.js:
```bash
cd /Users/jere/Code/@riffrafffilms/next-debug
# Edit package.json to point to local Next.js:
# "next": "file:./next.js/packages/next"
pnpm install
```

### Next.js Repository (`/Users/jere/Code/@riffrafffilms/next-debug/next.js`)
- ✅ Reset to latest canary branch
- ✅ All stashes cleared
- ✅ Clean working directory
- Current commit: e58657f6bd (latest canary)

**IMPORTANT:** You will need to install dependencies and build Next.js:
```bash
cd /Users/jere/Code/@riffrafffilms/next-debug/next.js
pnpm install  # Install dependencies (takes a while)
pnpm build    # Build Next.js (takes longer)
```

Or to build just the Babel bundle after making changes:
```bash
cd /Users/jere/Code/@riffrafffilms/next-debug/next.js/packages/next
pnpm taskr ncc_babel_bundle  # Quick rebuild of just Babel bundle
```

## Repository Structure

```
/Users/jere/Code/@riffrafffilms/next-debug/
├── next.js/                    # Fresh Next.js canary (needs build)
│   └── packages/next/
│       ├── src/
│       │   ├── bundles/babel/bundle.js      # Line 11: coreLibConfig()
│       │   └── build/babel/loader/
│       │       ├── get-config.ts            # Line 6: loadFullConfig import
│       │       └── transform.ts
│       └── taskfile.js         # Build commands (pnpm taskr ncc_babel_bundle)
├── app/
│   ├── page.tsx               # Main page
│   └── server.ts              # Code that triggers bug
├── gel-client.ts              # EdgeDB client export
├── dbschema/edgeql-js/        # Gel-generated code
│   └── index.ts               # Complex types that might cause issue (line 39: Set type)
├── README.md                  # Original bug description
└── HELP.md                    # This file (handoff documentation)
```

## Additional Context

- **Contributing docs:** `/Users/jere/Code/@riffrafffilms/next-debug/next.js/contributing.md`
- **Build docs:** `/Users/jere/Code/@riffrafffilms/next-debug/next.js/contributing/core/building.md`
- The user NEEDS this fixed urgently ("If you fail to find it, think out of the box and start again. It's crucial.")
- This is blocking their project deployment

## Expected Outcome

Find the actual root cause and create a fix that:
1. Allows the reproduction app to compile successfully
2. Can be submitted as a PR to Next.js
3. Is minimal and doesn't break other functionality

The fix should result in:
```
✓ Compiled / in X.Xs (XXX modules)
GET / 200 in XXXms
```

Instead of:
```
RangeError: Maximum call stack size exceeded
```
