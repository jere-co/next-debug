// Injected via NODE_OPTIONS=--require ./range-logger.js
// Captures RangeError stacks and logs recent async traces to help debug
// turbopack recursion issues.

const fs = require('fs');
const path = require('path');

const logFile = path.join(process.cwd(), '.next', 'range-error.log');

try {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
} catch (err) {
  // Ignore mkdir errors (likely EEXIST)
}

function logMessage(prefix, error) {
  const lines = [
    `==== ${prefix} ====`,
    new Date().toISOString(),
    `pid=${process.pid}`,
    error && error.stack ? error.stack : String(error),
    ''
  ];
  const message = lines.join('\n');
  try {
    fs.writeFileSync(logFile, message, { flag: 'a' });
  } catch (err) {
    // fall back to console if file write fails
    console.error('[range-logger] failed to write log:', err);
  }
  console.error(message);
}

process.on('unhandledRejection', (reason) => {
  if (reason instanceof RangeError) {
    logMessage('Unhandled RangeError', reason);
  } else {
    logMessage('Unhandled rejection', reason);
  }
});

process.on('uncaughtException', (error) => {
  if (error instanceof RangeError) {
    logMessage('Uncaught RangeError', error);
  } else {
    logMessage('Uncaught exception', error);
  }
  // Do not swallow the exception - rethrow to preserve default behavior.
  throw error;
});

// Increase stack trace depth in case V8 truncates ranges
Error.stackTraceLimit = Math.max(Error.stackTraceLimit || 10, 2000);

console.error('[range-logger] instrumentation active (pid=%d)', process.pid);
