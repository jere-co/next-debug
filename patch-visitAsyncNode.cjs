#!/usr/bin/env node

/**
 * Patch for React's visitAsyncNode infinite recursion bug
 *
 * This fixes the RangeError: Maximum call stack size exceeded that occurs
 * with Next.js 15.5.0+ when using database clients like Gel/EdgeDB that
 * create circular promise chains.
 *
 * Bug: React's visitAsyncNode uses `null` as both "in progress" marker and
 * a valid result, and doesn't cache `undefined` results. This causes infinite
 * recursion when circular async node references exist.
 *
 * Fix: Use an IN_PROGRESS sentinel symbol and always cache results.
 *
 * Usage:
 *   node patch-visitAsyncNode.js [--restore]
 *
 * Run after `npm install` / `pnpm install` to apply the patch.
 * Use --restore to revert to the original files.
 */

const fs = require("fs");
const path = require("path");

const RESTORE_MODE = process.argv.includes("--restore");

// Find Next.js installation
function findNextModules() {
	const nodeModules = path.join(process.cwd(), "node_modules");

	// Check for pnpm structure
	const pnpmPath = path.join(nodeModules, ".pnpm");
	if (fs.existsSync(pnpmPath)) {
		const dirs = fs.readdirSync(pnpmPath).filter((d) => d.startsWith("next@"));
		if (dirs.length > 0) {
			// Find the actual next package
			for (const dir of dirs) {
				const nextPath = path.join(pnpmPath, dir, "node_modules", "next");
				if (fs.existsSync(nextPath)) {
					return nextPath;
				}
			}
		}
	}

	// Check for regular npm/yarn structure
	const regularPath = path.join(nodeModules, "next");
	if (fs.existsSync(regularPath)) {
		return regularPath;
	}

	return null;
}

// Files that contain visitAsyncNode and need patching
const FILES_TO_PATCH = [
	"dist/compiled/next-server/app-page-turbo.runtime.dev.js",
	"dist/compiled/next-server/app-page.runtime.dev.js",
	"dist/compiled/next-server/app-page-experimental.runtime.dev.js",
	"dist/compiled/next-server/app-page-turbo-experimental.runtime.dev.js",
	"dist/server/app-page-turbo.runtime.dev.js",
];

function patchFile(filePath) {
	if (!fs.existsSync(filePath)) {
		return { skipped: true, reason: "File not found" };
	}

	const backupPath = filePath + ".bak";

	if (RESTORE_MODE) {
		if (fs.existsSync(backupPath)) {
			fs.copyFileSync(backupPath, filePath);
			fs.unlinkSync(backupPath);
			return { restored: true };
		}
		return { skipped: true, reason: "No backup found" };
	}

	let content = fs.readFileSync(filePath, "utf8");

	// Check if already patched
	if (content.includes("react.asyncTraversal.inProgress")) {
		return { skipped: true, reason: "Already patched" };
	}

	// Check if file contains visitAsyncNode
	if (!content.includes("function visitAsyncNode(")) {
		return { skipped: true, reason: "visitAsyncNode not found" };
	}

	// Backup original
	fs.copyFileSync(filePath, backupPath);

	// Find a good spot to insert IN_PROGRESS constant (before visitAsyncNode function)
	const funcStart = content.indexOf(
		"function visitAsyncNode(request,task,node,visited,cutOff)",
	);
	if (funcStart === -1) {
		return { skipped: true, reason: "Could not find visitAsyncNode signature" };
	}

	// Insert IN_PROGRESS constant
	const IN_PROGRESS_CONST =
		'var IN_PROGRESS=Symbol.for("react.asyncTraversal.inProgress");';
	const insertPos = content.lastIndexOf(";", funcStart);
	if (insertPos === -1) {
		return { skipped: true, reason: "Could not find insertion point" };
	}

	content =
		content.slice(0, insertPos + 1) +
		IN_PROGRESS_CONST +
		content.slice(insertPos + 1);

	// Fix the visitAsyncNode function
	// Pattern 1 (Next.js 15.x / older 16.x):
	//   if(visited.has(node))return visited.get(node);visited.set(node,null);
	// Pattern 2 (Next.js 16.0.5+):
	//   return visited.has(node)?visited.get(node):(visited.set(node,null),

	let patched = false;

	// Pattern 1: if-statement style
	const pattern1 =
		/function visitAsyncNode\(request,task,node,visited,cutOff\)\{if\(visited\.has\(node\)\)return visited\.get\(node\);visited\.set\(node,null\);/g;
	const replacement1 =
		"function visitAsyncNode(request,task,node,visited,cutOff){if(visited.has(node)){var memo=visited.get(node);if(memo===IN_PROGRESS)return void 0;return memo}visited.set(node,IN_PROGRESS);";

	if (pattern1.test(content)) {
		content = content.replace(pattern1, replacement1);
		patched = true;
	}

	// Pattern 2: ternary style (Next.js 16.0.5+)
	const pattern2 =
		/function visitAsyncNode\(request,task,node,visited,cutOff\)\{return visited\.has\(node\)\?visited\.get\(node\):\(visited\.set\(node,null\),/g;
	const replacement2 =
		"function visitAsyncNode(request,task,node,visited,cutOff){if(visited.has(node)){var memo=visited.get(node);if(memo===IN_PROGRESS)return void 0;return memo}visited.set(node,IN_PROGRESS);return(";

	if (pattern2.test(content)) {
		content = content.replace(pattern2, replacement2);
		patched = true;
	}

	if (!patched) {
		// Restore backup since we couldn't apply the patch
		fs.copyFileSync(backupPath, filePath);
		fs.unlinkSync(backupPath);
		return {
			skipped: true,
			reason:
				"Could not match visitAsyncNode pattern (may be different minification)",
		};
	}

	// Fix result caching - ensure we always cache (including null/undefined)
	// Old pattern: null!==<var>&&visited.set(node,<var>),<var>}
	// New pattern: visited.set(node,<var>),<var>}
	content = content.replace(
		/null!==([a-zA-Z_$][a-zA-Z0-9_$]*)&&visited\.set\(node,\1\),\1\}/g,
		"visited.set(node,$1),$1}",
	);

	fs.writeFileSync(filePath, content);
	return { patched: true };
}

function main() {
	console.log(
		RESTORE_MODE
			? "🔄 Restoring original Next.js files..."
			: "🔧 Patching Next.js for visitAsyncNode fix...",
	);
	console.log("");

	const nextPath = findNextModules();
	if (!nextPath) {
		console.error("❌ Could not find Next.js installation in node_modules");
		console.error(
			"   Make sure you run this from your project root after installing dependencies.",
		);
		process.exit(1);
	}

	console.log(`📁 Found Next.js at: ${nextPath}`);
	console.log("");

	let patchedCount = 0;
	let skippedCount = 0;
	let restoredCount = 0;

	for (const file of FILES_TO_PATCH) {
		const filePath = path.join(nextPath, file);
		const relativePath = path.relative(process.cwd(), filePath);

		const result = patchFile(filePath);

		if (result.patched) {
			console.log(`✅ Patched: ${relativePath}`);
			patchedCount++;
		} else if (result.restored) {
			console.log(`🔄 Restored: ${relativePath}`);
			restoredCount++;
		} else if (result.skipped) {
			console.log(`⏭️  Skipped: ${relativePath} (${result.reason})`);
			skippedCount++;
		}
	}

	console.log("");
	if (RESTORE_MODE) {
		console.log(
			`📊 Summary: ${restoredCount} restored, ${skippedCount} skipped`,
		);
	} else {
		console.log(`📊 Summary: ${patchedCount} patched, ${skippedCount} skipped`);

		if (patchedCount > 0) {
			console.log("");
			console.log("✨ Patch applied successfully!");
			console.log("");
			console.log("Note: You need to re-run this script after:");
			console.log("  - Running npm/pnpm/yarn install");
			console.log("  - Updating Next.js");
			console.log("");
			console.log(
				"To restore original files: node patch-visitAsyncNode.js --restore",
			);
		}
	}
}

main();
