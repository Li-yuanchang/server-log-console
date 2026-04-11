/**
 * 打包前准备：将 gateway 及其依赖收集到 .electron-build/gateway/ 目录
 * 解决 monorepo hoisted node_modules 问题
 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const BUILD_DIR = path.join(__dirname, ".electron-build", "gateway");
const SHARED_DIR = path.join(ROOT, "packages", "shared");
const GATEWAY_DIR = path.join(ROOT, "apps", "gateway");
const EXTENSION_DIST = path.join(ROOT, "apps", "extension", "dist");

// Clean
if (fs.existsSync(path.join(__dirname, ".electron-build"))) {
  fs.rmSync(path.join(__dirname, ".electron-build"), { recursive: true });
}

// Create dirs
fs.mkdirSync(BUILD_DIR, { recursive: true });
fs.mkdirSync(path.join(BUILD_DIR, "node_modules", "@server-log-console"), { recursive: true });

// Copy gateway dist
copyDirSync(path.join(GATEWAY_DIR, "dist"), path.join(BUILD_DIR, "dist"));

// Copy gateway package.json (strip devDependencies and local workspace dep)
const gwPkg = JSON.parse(fs.readFileSync(path.join(GATEWAY_DIR, "package.json"), "utf8"));
delete gwPkg.devDependencies;
delete gwPkg.dependencies["@server-log-console/shared"];
fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify(gwPkg, null, 2));

// Install third-party production deps
console.log("Installing gateway production dependencies...");
execSync("npm install --omit=dev --ignore-scripts", {
  cwd: BUILD_DIR,
  stdio: "inherit",
});

// Copy shared package manually
const sharedTarget = path.join(BUILD_DIR, "node_modules", "@server-log-console", "shared");
fs.mkdirSync(path.dirname(sharedTarget), { recursive: true });
copyDirSync(SHARED_DIR, sharedTarget);

// Copy extension dist for gateway to serve
const extTarget = path.join(BUILD_DIR, "..", "extension", "dist");
fs.mkdirSync(path.dirname(extTarget), { recursive: true });
copyDirSync(EXTENSION_DIST, extTarget);

console.log("Gateway preparation complete.");

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
