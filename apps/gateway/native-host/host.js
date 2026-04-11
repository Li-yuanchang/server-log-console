#!/usr/bin/env node

/**
 * Chrome Native Messaging Host
 * 
 * 负责接收来自 Chrome 扩展的消息，管理 gateway 进程的生命周期。
 * 协议：stdin/stdout 传输 length-prefixed JSON 消息。
 *
 * 支持的 action：
 *   - start  → 启动 gateway（如果未运行）
 *   - stop   → 停止 gateway
 *   - status → 检查 gateway 是否在运行
 */

import { spawn, execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../../..");
const GATEWAY_DIR = path.resolve(__dirname, "..");
const PID_FILE = path.join(GATEWAY_DIR, ".gateway.pid");

// --- Native Messaging I/O helpers ---

function readMessage() {
  return new Promise((resolve, reject) => {
    const header = Buffer.alloc(4);
    let offset = 0;

    function onReadable() {
      while (offset < 4) {
        const chunk = process.stdin.read(4 - offset);
        if (!chunk) return;
        chunk.copy(header, offset);
        offset += chunk.length;
      }
      process.stdin.removeListener("readable", onReadable);

      const msgLen = header.readUInt32LE(0);
      if (msgLen === 0 || msgLen > 1024 * 1024) {
        reject(new Error(`Invalid message length: ${msgLen}`));
        return;
      }

      let body = "";
      let remaining = msgLen;

      function onData() {
        while (remaining > 0) {
          const chunk = process.stdin.read(remaining);
          if (!chunk) return;
          body += chunk.toString("utf-8");
          remaining -= chunk.length;
        }
        process.stdin.removeListener("readable", onData);
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`Invalid JSON: ${body}`));
        }
      }

      process.stdin.on("readable", onData);
      onData();
    }

    process.stdin.on("readable", onReadable);
    onReadable();
  });
}

function sendMessage(msg) {
  const json = JSON.stringify(msg);
  const buf = Buffer.from(json, "utf-8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(buf.length, 0);
  process.stdout.write(header);
  process.stdout.write(buf);
}

// --- Gateway process management ---

function isGatewayRunning() {
  return new Promise((resolve) => {
    const port = process.env.PORT || 4040;
    const req = http.get(`http://127.0.0.1:${port}/health`, { timeout: 2000 }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          resolve(json.ok === true);
        } catch {
          resolve(false);
        }
      });
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

function readPid() {
  try {
    if (existsSync(PID_FILE)) {
      const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
      if (pid > 0) return pid;
    }
  } catch {}
  return null;
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function startGateway() {
  const running = await isGatewayRunning();
  if (running) {
    return { ok: true, action: "start", message: "Gateway already running", pid: readPid() };
  }

  // 检查是否已构建
  const distIndex = path.join(GATEWAY_DIR, "dist", "index.js");
  if (!existsSync(distIndex)) {
    try {
      execSync("npm run build", { cwd: PROJECT_ROOT, timeout: 60000, stdio: "ignore" });
    } catch (e) {
      return { ok: false, action: "start", message: "Build failed: " + (e.message || "unknown error") };
    }
  }

  const child = spawn("node", [distIndex], {
    cwd: GATEWAY_DIR,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, NODE_ENV: "production" }
  });

  child.unref();
  const pid = child.pid;

  if (pid) {
    writeFileSync(PID_FILE, String(pid), "utf-8");
  }

  // 等待 gateway 启动（最多 8 秒）
  for (let i = 0; i < 16; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isGatewayRunning()) {
      return { ok: true, action: "start", message: "Gateway started", pid };
    }
  }

  return { ok: false, action: "start", message: "Gateway started but health check failed", pid };
}

async function stopGateway() {
  const pid = readPid();
  if (pid && isProcessAlive(pid)) {
    try {
      process.kill(pid, "SIGTERM");
      try { unlinkSync(PID_FILE); } catch {}
      return { ok: true, action: "stop", message: "Gateway stopped", pid };
    } catch (e) {
      return { ok: false, action: "stop", message: "Failed to stop: " + e.message, pid };
    }
  }
  try { unlinkSync(PID_FILE); } catch {}
  return { ok: true, action: "stop", message: "Gateway was not running" };
}

async function statusGateway() {
  const running = await isGatewayRunning();
  const pid = readPid();
  return { ok: true, action: "status", running, pid };
}

// --- Main ---

async function main() {
  try {
    const msg = await readMessage();
    let response;

    switch (msg.action) {
      case "start":
        response = await startGateway();
        break;
      case "stop":
        response = await stopGateway();
        break;
      case "status":
        response = await statusGateway();
        break;
      default:
        response = { ok: false, message: `Unknown action: ${msg.action}` };
    }

    sendMessage(response);
  } catch (e) {
    sendMessage({ ok: false, message: e.message || "Host error" });
  }

  process.exit(0);
}

main();
