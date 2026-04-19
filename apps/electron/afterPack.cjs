const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appPath = context.appOutDir;
  const appName = context.packager.appInfo.productFilename;
  const appBundle = path.join(appPath, `${appName}.app`);
  const resourcesDir = path.join(appBundle, "Contents", "Resources");
  const infoPlist = path.join(appBundle, "Contents", "Info.plist");
  const iconFileName = "icon.icns";

  // 1. Ensure CFBundleName exists — Electron uses it to locate helper apps.
  //    electron-builder 25.x may omit it; without it the app silently exits.
  try {
    execSync(`/usr/libexec/PlistBuddy -c "Add :CFBundleName string ${appName}" "${infoPlist}"`, { stdio: "pipe" });
    console.log(`[afterPack] Added CFBundleName = ${appName}`);
  } catch (_) {
    // Key already exists — make sure it matches
    try {
      execSync(`/usr/libexec/PlistBuddy -c "Set :CFBundleName ${appName}" "${infoPlist}"`, { stdio: "pipe" });
      console.log(`[afterPack] Set CFBundleName = ${appName}`);
    } catch (e2) {
      console.warn("[afterPack] CFBundleName error:", e2.message);
    }
  }

  try {
    execSync(`/usr/libexec/PlistBuddy -c "Add :CFBundleIconFile string ${iconFileName}" "${infoPlist}"`, { stdio: "pipe" });
    console.log(`[afterPack] Added CFBundleIconFile = ${iconFileName}`);
  } catch (_) {
    try {
      execSync(`/usr/libexec/PlistBuddy -c "Set :CFBundleIconFile ${iconFileName}" "${infoPlist}"`, { stdio: "pipe" });
      console.log(`[afterPack] Set CFBundleIconFile = ${iconFileName}`);
    } catch (e2) {
      console.warn("[afterPack] CFBundleIconFile error:", e2.message);
    }
  }

  if (!fs.existsSync(path.join(resourcesDir, iconFileName))) {
    console.warn(`[afterPack] Missing bundled icon: ${path.join(resourcesDir, iconFileName)}`);
  }

  // 2. Inject zh_CN InfoPlist.strings for Chinese display name
  const lprojDir = path.join(resourcesDir, "zh_CN.lproj");
  fs.mkdirSync(lprojDir, { recursive: true });
  fs.writeFileSync(
    path.join(lprojDir, "InfoPlist.strings"),
    'CFBundleDisplayName = "日志控制台";\n',
    "utf-8"
  );
  console.log("[afterPack] Injected zh_CN InfoPlist.strings");
};
