/**
 * 打包前准备：写入在线更新源配置到 .update-config/update-config.json
 * 该文件随包分发到 resources/update-config/，供主进程解析更新源地址。
 * 取值优先级：环境变量 SLC_UPDATE_URL → 已存在的 update-config.local.json → 空
 */
const fs = require("fs");
const path = require("path");

const CONFIG_DIR = path.join(__dirname, ".update-config");
const CONFIG_FILE = path.join(CONFIG_DIR, "update-config.json");
const LOCAL_FILE = path.join(__dirname, "update-config.local.json");

function readLocalUrl() {
  try {
    if (!fs.existsSync(LOCAL_FILE)) return "";
    const parsed = JSON.parse(fs.readFileSync(LOCAL_FILE, "utf8"));
    const url = typeof parsed === "string" ? parsed : parsed?.updateUrl;
    return typeof url === "string" ? url.trim() : "";
  } catch {
    return "";
  }
}

const envUrl = (process.env.SLC_UPDATE_URL || "").trim();
const updateUrl = envUrl || readLocalUrl();

fs.mkdirSync(CONFIG_DIR, { recursive: true });
fs.writeFileSync(CONFIG_FILE, `${JSON.stringify({ updateUrl }, null, 2)}\n`, "utf8");
console.log(`[prepare-update-config] updateUrl=${updateUrl || "(empty)"}`);
