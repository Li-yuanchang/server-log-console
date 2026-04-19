const fs = require("fs");
const path = require("path");

const packageJsonPath = path.join(__dirname, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const currentVersion = String(packageJson.version || "0.0.0").trim();
const match = currentVersion.match(/^(\d+)\.(\d+)\.(\d+)(.*)?$/);

if (!match) {
  throw new Error(`Unsupported version format: ${currentVersion}`);
}

const nextVersion = `${match[1]}.${match[2]}.${Number(match[3]) + 1}${match[4] || ""}`;
packageJson.version = nextVersion;
fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
console.log(`[bump-version] ${currentVersion} -> ${nextVersion}`);
