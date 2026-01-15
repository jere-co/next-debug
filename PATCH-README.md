# visitAsyncNode Patch

Fixes the `RangeError: Maximum call stack size exceeded` bug in Next.js 15.5.0+ / 16.x with React 19.2.0+.

**Tested with:** Next.js 16.1.2, React 19.2.3

## The Bug

React's `visitAsyncNode` function enters infinite recursion when your app uses database clients (like Gel/EdgeDB) that create circular promise chains.

## Usage

1. Copy `patch-visitAsyncNode.cjs` to your project root
2. Run it after installing dependencies:

```bash
node patch-visitAsyncNode.cjs
```

Or add to `package.json`:

```json
{
  "scripts": {
    "postinstall": "node patch-visitAsyncNode.cjs"
  }
}
```

## Restore Original

```bash
node patch-visitAsyncNode.cjs --restore
```

## Requirements

- Node.js
- Next.js 15.5.0+ or 16.x installed in `node_modules`

Works with npm, yarn, and pnpm.
