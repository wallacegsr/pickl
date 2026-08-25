// Production startup script: applies any pending DB migrations, then starts
// the Next.js standalone server. Used as the container CMD and also works
// for `npm start` locally after `npm run build`.
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

console.log("Running database migrations...");
execFileSync(process.execPath, [path.join(__dirname, "migrate.mjs")], {
  stdio: "inherit",
});

const standaloneServer = path.join(process.cwd(), "server.js");

if (fs.existsSync(standaloneServer)) {
  console.log("Starting Next.js standalone server...");
  require(standaloneServer);
} else {
  // Local `npm start` without a standalone build — fall back to `next start`.
  console.log("No standalone server.js found, falling back to `next start`.");
  execFileSync(
    process.execPath,
    [require.resolve("next/dist/bin/next"), "start"],
    { stdio: "inherit" }
  );
}
