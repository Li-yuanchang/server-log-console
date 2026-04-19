#!/usr/bin/env node
const { execFileSync, spawnSync } = require("child_process");
const readline = require("readline");

function loadProcesses() {
  const output = execFileSync("ps", ["-axo", "pid=,ppid=,user=,stat=,command="], {
    encoding: "utf8"
  });

  return output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map(parseProcessLine)
    .filter(Boolean);
}

function parseProcessLine(line) {
  const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/);
  if (!match) {
    return null;
  }

  return {
    pid: Number(match[1]),
    ppid: Number(match[2]),
    user: match[3],
    stat: match[4],
    command: match[5].trim()
  };
}

function inspectZombies() {
  const processes = loadProcesses();
  const byPid = new Map(processes.map((processInfo) => [processInfo.pid, processInfo]));
  const zombies = processes.filter((processInfo) => processInfo.stat.includes("Z"));
  return { byPid, zombies };
}

function formatCommand(command) {
  return command || "(unknown)";
}

function printSummary(zombies) {
  const ownerCounts = new Map();
  for (const zombie of zombies) {
    ownerCounts.set(zombie.user, (ownerCounts.get(zombie.user) || 0) + 1);
  }

  console.log(`发现 ${zombies.length} 个僵尸进程。`);
  console.log("僵尸进程所属用户统计：");
  for (const [user, count] of [...ownerCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`  - ${user}: ${count} 个`);
  }
}

function groupZombiesByParent(zombies, byPid) {
  const groups = new Map();
  for (const zombie of zombies) {
    const ppid = zombie.ppid;
    if (!groups.has(ppid)) {
      groups.set(ppid, { parent: byPid.get(ppid) || null, zombies: [] });
    }
    groups.get(ppid).zombies.push(zombie);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]);
}

function printParentGroup(group, index, total) {
  const { parent, zombies } = group;
  const pids = zombies.map((z) => z.pid).join(", ");
  console.log(`\n[${index}/${total}] 僵尸进程 PID ${pids}（共 ${zombies.length} 个）`);
  for (const z of zombies) {
    console.log(`  PID ${z.pid}: 用户=${z.user} 命令=${formatCommand(z.command)}`);
  }

  if (parent) {
    console.log(`  父进程: PID ${parent.pid}`);
    console.log(`  父进程用户: ${parent.user}`);
    console.log(`  父进程状态: ${parent.stat}`);
    console.log(`  父进程命令: ${formatCommand(parent.command)}`);
  } else {
    console.log(`  父进程: PID ${zombies[0].ppid}（已不存在或无法读取）`);
  }
}

function askQuestion(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

function isYes(answer) {
  const normalized = answer.trim().toLowerCase();
  return normalized === "y" || normalized === "yes";
}

function isKillConfirmed(answer) {
  return answer.trim().toLowerCase() === "kill";
}

function createReadline() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

function signalParent(parentPid, signalName, useSudo) {
  const args = useSudo ? ["sudo", "kill", `-${signalName}`, String(parentPid)] : ["kill", `-${signalName}`, String(parentPid)];
  const cmd = useSudo ? "sudo" : "kill";
  const cmdArgs = useSudo ? args.slice(1) : args.slice(1);

  const result = spawnSync(cmd, cmdArgs, { encoding: "utf8" });

  if (result.error) {
    return { ok: false, message: result.error.message, permissionDenied: false };
  }

  if (result.status !== 0) {
    const stderr = (result.stderr || "").trim();
    const permissionDenied = /operation not permitted/i.test(stderr) || /permission denied/i.test(stderr);
    return { ok: false, message: stderr || `kill exited with code ${result.status}`, permissionDenied };
  }

  return { ok: true, message: `已向父进程 ${parentPid} 发送 SIG${signalName}`, permissionDenied: false };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tryCleanupParentGroup(rl, group, index, total) {
  printParentGroup(group, index, total);

  const { parent, zombies } = group;

  if (!parent) {
    console.log("  无法处理：父进程已不存在，通常会由系统自行回收。\n");
    return;
  }

  if (parent.pid <= 1) {
    console.log("  跳过：父进程是系统关键进程，不建议由脚本处理。\n");
    return;
  }

  console.log("  说明: 僵尸进程本身不能直接 kill，只能尝试结束它的父进程来触发回收。");
  const answer = await askQuestion(rl, `  是否尝试结束父进程 ${parent.pid}（用户 ${parent.user}）？[y/N]: `);
  if (!isYes(answer)) {
    console.log("  已跳过。\n");
    return;
  }

  let termResult = signalParent(parent.pid, "TERM", false);
  console.log(`  ${termResult.message}`);

  if (!termResult.ok && termResult.permissionDenied) {
    console.log("  权限不足，尝试使用 sudo...");
    termResult = signalParent(parent.pid, "TERM", true);
    console.log(`  ${termResult.message}`);
  }

  if (!termResult.ok) {
    console.log();
    return;
  }

  await delay(1200);
  const afterTerm = inspectZombies();
  const remaining = zombies.filter((z) => {
    const current = afterTerm.byPid.get(z.pid);
    return current && current.stat.includes("Z");
  });

  if (remaining.length === 0) {
    console.log("  僵尸进程已被回收。\n");
    return;
  }

  console.log(`  仍有 ${remaining.length} 个僵尸进程，父进程可能还未退出。\n`);
  rl.close();
  rl = createReadline();
  const forceAnswer = await askQuestion(rl, `  确认对父进程 ${parent.pid} 发送 SIGKILL（不可恢复），请输入 kill 确认: `);
  if (!isKillConfirmed(forceAnswer)) {
    console.log("  已停止进一步处理。\n");
    return;
  }

  let killResult = signalParent(parent.pid, "KILL", false);
  console.log(`  ${killResult.message}`);

  if (!killResult.ok && killResult.permissionDenied) {
    console.log("  权限不足，尝试使用 sudo...");
    killResult = signalParent(parent.pid, "KILL", true);
    console.log(`  ${killResult.message}`);
  }

  if (!killResult.ok) {
    console.log();
    return;
  }

  await delay(800);
  const afterKill = inspectZombies();
  const stillRemaining = zombies.filter((z) => {
    const current = afterKill.byPid.get(z.pid);
    return current && current.stat.includes("Z");
  });

  if (stillRemaining.length === 0) {
    console.log("  僵尸进程已被回收。\n");
    return;
  }

  console.log("  僵尸进程仍存在，请手动排查父进程是否被系统托管或需要重启对应服务。\n");
}

async function main() {
  let snapshot;

  try {
    snapshot = inspectZombies();
  } catch (error) {
    console.error(`读取进程列表失败: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  if (snapshot.zombies.length === 0) {
    console.log("当前没有发现僵尸进程。");
    return;
  }

  printSummary(snapshot.zombies);
  console.log();
  console.log("注意: 脚本会按父进程分组询问你是否尝试结束对应父进程。\n");

  const groups = groupZombiesByParent(snapshot.zombies, snapshot.byPid);
  let rl = createReadline();

  try {
    for (const [index, [, group]] of groups.entries()) {
      await tryCleanupParentGroup(rl, group, index + 1, groups.length);
    }
  } finally {
    rl.close();
  }

  const finalSnapshot = inspectZombies();
  console.log(`处理完成，当前剩余 ${finalSnapshot.zombies.length} 个僵尸进程。`);
  if (finalSnapshot.zombies.length > 0) {
    printSummary(finalSnapshot.zombies);
  }
}

main();
