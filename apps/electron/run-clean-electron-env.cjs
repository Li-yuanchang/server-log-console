const { spawn } = require("child_process");

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error("Usage: node run-clean-electron-env.cjs <command> [args...]");
  process.exit(1);
}

const [command, ...commandArgs] = args;
const env = { ...process.env };

delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(command, commandArgs, {
  stdio: "inherit",
  env,
  shell: process.platform === "win32",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
