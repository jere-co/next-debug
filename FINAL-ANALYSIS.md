# Final Bug Analysis: React 19.2.0 visitAsyncNode Infinite Recursion

## ✅ Bug Found and Fixed!

### Executive Summary

The bug causing `RangeError: Maximum call stack size exceeded` when using Gel/EdgeDB client with Next.js 16 has been **identified in React's source code** and **already fixed** (but not yet released).

---

## 🐛 The Bug

**Location:** `react/packages/react-server/src/ReactFlightServer.js` line 2315

**Affected Versions:** React 19.2.0 (released with Next.js 16.0.1)

**Bug Introduced:** Commit `acee65d6d031697ab8c71932a5b028351cbc3b03` on June 3, 2025

### Buggy Code (React 19.2.0):

```javascript
function visitAsyncNode(
  request: Request,
  task: Task,
  node: AsyncSequence,
  visited: Set<AsyncSequence | ReactDebugInfo>,  // ❌ Using Set
  cutOff: number,
): void | null | PromiseNode | IONode {
  if (visited.has(node)) {
    return null;  // ❌ Always returns null for revisited nodes
  }
  visited.add(node);  // ❌ Only marks as visited, doesn't cache result
  
  // ... rest of function processes the node recursively
}
```

### Why It Causes Infinite Recursion:

1. When `visitAsyncNode` encounters a node it's seen before, it returns `null`
2. The caller checks if result is `undefined` (for early abort), not `null`
3. So returning `null` doesn't stop the recursion - it continues processing
4. With Gel client's circular promise chains (A awaits B, B awaits A), this creates infinite recursion
5. Eventually: `RangeError: Maximum call stack size exceeded`

---

## ✅ The Fix

**Fixed By:** Commit `4f93170066c5ee7519749b45c5962a6b970cf977` on October 29, 2025 (yesterday!)

**Status:** Merged to React main branch, **not yet released**

### Fixed Code:

```javascript
function visitAsyncNode(
  request: Request,
  task: Task,
  node: AsyncSequence,
  visited: Map<  // ✅ Changed to Map to cache results
    AsyncSequence | ReactDebugInfo,
    void | null | PromiseNode | IONode,
  >,
  cutOff: number,
): void | null | PromiseNode | IONode {
  if (visited.has(node)) {
    return visited.get(node);  // ✅ Returns cached result, not always null
  }
  
  visited.set(node, null);  // ✅ Mark as visiting
  const result = visitAsyncNodeImpl(request, task, node, visited, cutOff);
  
  if (result !== null) {
    visited.set(node, result);  // ✅ Cache the actual result
  }
  
  return result;
}
```

### What the Fix Does:

1. Changes `visited` from **Set** to **Map** 
2. Caches the actual result of visiting each node
3. When revisiting a node, returns the **cached result** instead of always `null`
4. Properly handles circular references by returning the correct cached value
5. Prevents infinite recursion

---

## 📊 Timeline

| Date | Event |
|------|-------|
| June 3, 2025 | Bug introduced in commit `acee65d6d0` |
| React 19.2.0 release | Bug shipped to production |
| Next.js 16.0.1 | Ships with React 19.2.0 (buggy) |
| Oct 29, 2025 | Fix merged in commit `4f93170066` |
| Oct 30, 2025 | Bug discovered by you |
| **Pending** | React 19.2.1 or 19.3.0 release with fix |

---

## 🔍 Root Cause Details

### The Circular Reference

From instrumentation logs:
```
[visitAsyncNode] cycle tag=1 awaitedTag=2
[visitAsyncNode] cycle tag=2 awaitedTag=1
```

- **Node A** (tag=1) has `awaited` property → **Node B** (tag=2)
- **Node B** (tag=2) has `awaited` property → **Node A** (tag=1)

### Why Gel Client Triggers This

The Gel/EdgeDB client's `.run()` method creates complex promise chains that expose this React bug:

```typescript
const query = e.select(e.Post, () => ({ id: true }));
const result = await query.run(gelClient);  // 🔥 Circular promise metadata
```

The Gel client wraps promises in ways that create circular references in React's async tracking metadata, triggering the bug.

---

## 🛠️ Solutions

### Option 1: Wait for Official Release (Recommended)

The fix exists in React's main branch and will be released soon, likely as:
- React 19.2.1 (patch release)
- React 19.3.0 (minor release)

**Estimated timeline:** Days to weeks

### Option 2: Patch React Locally (Immediate)

Apply the fix manually to your `node_modules`:

1. **File to patch:** 
   ```
   node_modules/react-server-dom-webpack/cjs/react-server-dom-webpack-server.node.development.js
   ```

2. **Find line ~2042** with:
   ```javascript
   function visitAsyncNode(request, task, node, visited, cutOff) {
     if (visited.has(node)) {
       return null;  // ❌ Change this
     }
     visited.add(node);  // ❌ Change this
   ```

3. **Replace with:**
   ```javascript
   function visitAsyncNode(request, task, node, visited, cutOff) {
     if (visited.has(node)) {
       return visited.get(node);  // ✅ Fixed
     }
     visited.set(node, null);  // ✅ Fixed
     var result = visitAsyncNodeImpl(request, task, node, visited, cutOff);
     if (result !== null) {
       visited.set(node, result);  // ✅ Fixed
     }
     return result;
   ```

4. **Also update the function signature** to split into `visitAsyncNode` and `visitAsyncNodeImpl`

**Note:** This is hacky and will be overwritten on `npm install`. Use patch-package to persist.

### Option 3: Use React from Main Branch (For Testing)

```bash
# Clone React
git clone https://github.com/facebook/react.git
cd react

# Build React
npm install
npm run build

# Link to your project
cd packages/react
npm link
cd ../react-dom  
npm link

cd /path/to/your/project
npm link react react-dom
```

### Option 4: Downgrade Next.js (Workaround)

Use Next.js 15.4.7 which ships with React 19.1.x (before the bug):

```json
{
  "dependencies": {
    "next": "15.4.7",
    "react": "^19.1.0",
    "react-dom": "^19.1.0"
  }
}
```

---

## 📝 Reporting

### To React Team

The bug is already fixed! No need to report - it's commit `4f93170066`.

You could:
- Comment on PR #35005: https://github.com/facebook/react/pull/35005
- Ask when React 19.2.1 will be released
- Mention this affects Gel/EdgeDB users with Next.js

### To Next.js Team

You could report that Next.js 16.0.1 ships with buggy React 19.2.0 and suggest:
- Wait for React 19.2.1 before releasing Next.js 16.1.0
- Or temporarily patch React in Next.js's vendored copy

### To Gel/EdgeDB Team

This is not a Gel bug, but you could inform them that:
- Gel works fine with React 19.1.x
- Gel triggers a React 19.2.0 bug (now fixed in React main)
- Users should use Next.js 15.x until React 19.2.1 is released

---

## 🎯 Your Current Setup

From your `package.json`:
```json
{
  "next": "16.0.1",
  "react": "19.2.0",      // ❌ Has the bug
  "react-dom": "19.2.0"   // ❌ Has the bug  
}
```

**Recommendation:** Downgrade to Next.js 15.4.7 until React 19.2.1 is released.

---

## 📚 Related Files

- **Bug Report:** `BUG-REPORT.md`
- **Root Cause Analysis:** `ROOT-CAUSE-ANALYSIS.md`
- **This Summary:** `FINAL-ANALYSIS.md`

---

## 🏆 Key Commits

| Commit | Description | Link |
|--------|-------------|------|
| `acee65d6d0` | Bug introduction (June 3, 2025) | [View](https://github.com/facebook/react/commit/acee65d6d0) |
| `4f93170066` | Bug fix (Oct 29, 2025) | [View](https://github.com/facebook/react/commit/4f93170066) |

---

## ✨ Success!

**Bug Status:** ✅ Identified, ✅ Fixed in React main, ⏳ Waiting for release

The investigation successfully:
1. ✅ Reproduced the bug consistently
2. ✅ Isolated the trigger (Gel's `.run()` method)
3. ✅ Found the exact code causing infinite recursion
4. ✅ Located the fix in React's main branch
5. ✅ Provided multiple workarounds

**You can now:**
- Apply a local patch for immediate fix
- Downgrade to Next.js 15.4.7 as temporary workaround  
- Wait for React 19.2.1 official release
- Report findings to React/Next.js teams with evidence
