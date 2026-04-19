const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const launchEnv = { ...process.env };
delete launchEnv.ELECTRON_RUN_AS_NODE;

const appName = "ServerLogConsole.app";
const appCandidates = [
  path.join(__dirname, "dist", "mac-arm64", appName),
  path.join(__dirname, "dist", "mac", appName),
];
const sourceApp = appCandidates.find((candidate) => fs.existsSync(candidate));

if (!sourceApp) {
  throw new Error(`Packaged app not found. Checked: ${appCandidates.join(", ")}`);
}

const destinationApp = path.join("/Applications", appName);

try {
  execFileSync("osascript", ["-e", 'tell application "ServerLogConsole" to quit'], { stdio: "ignore" });
} catch {}

if (fs.existsSync(destinationApp)) {
  fs.rmSync(destinationApp, { recursive: true, force: true });
}

execFileSync("ditto", [sourceApp, destinationApp], { stdio: "inherit" });
execFileSync("open", ["-a", destinationApp], { stdio: "inherit", env: launchEnv });

console.log(`[install-mac-app] installed ${sourceApp} -> ${destinationApp}`);
console.log(`[install-mac-app] launched ${destinationApp}`);
