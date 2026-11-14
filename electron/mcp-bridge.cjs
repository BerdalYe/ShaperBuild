// The MCP bridge on its own, run as plain Node.js by AI apps such as Claude
// Desktop: ShaperBuild's program with ELECTRON_RUN_AS_NODE=1 and this file.
// It has no window, so its input and output work on every system (a
// windowed app on Windows gets no standard input from the app that started
// it). Usage: mcp-bridge.cjs --user-data <ShaperBuild's data folder>
const { runBridge } = require('./mcp.cjs');

process.on('uncaughtException', (err) => {
  // Shows in the AI app's log for this server.
  console.error(`ShaperBuild MCP bridge: ${err.stack || err.message}`);
  process.exit(1);
});

const i = process.argv.indexOf('--user-data');
const userData = i > 0 ? process.argv[i + 1] : null;
if (!userData) {
  console.error('ShaperBuild MCP bridge: missing --user-data <folder>');
  process.exit(2);
}
runBridge({ userData, version: process.env.SHAPERBUILD_VERSION || '' });
