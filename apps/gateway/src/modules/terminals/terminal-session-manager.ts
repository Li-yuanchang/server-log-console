import type { ClientChannel } from "ssh2";
import { WebSocket } from "ws";

export interface TerminalSessionState {
  sessionId: string;
  socket: WebSocket | null;
  shellStream: ClientChannel;
  cleanup: () => void;
  keepaliveTimer: ReturnType<typeof setInterval> | null;
  detachTimer: ReturnType<typeof setTimeout> | null;
  transcript: string;
}

const DETACHED_SESSION_TTL_MS = 90 * 1000;
const MAX_TRANSCRIPT_CHARS = 200_000;
const terminalSessions = new Map<string, TerminalSessionState>();

/**
 * 终端「查询序列」——PTY 向终端提问、终端必须回包的那些控制序列。
 *
 * 为什么要在网关侧剔除（2026-11-17）：
 * transcript 是**整段回放**给新 socket 的（见 attachTerminalSession 的 ready 帧），
 * 里面一旦残留查询序列，xterm 重新解析时会再次自动应答，应答经 onData 回传 PTY，
 * 远端 shell 就把应答当命令执行，于是刷出
 * `-bash: 2R11: 未找到命令` / `rgb:0000/0000/0000: 没有那个文件或目录`。
 * 客户端已加应答过滤，这里从源头不让查询进入 transcript，双层防护。
 *
 * 只剔除「查询」（会触发回包），不动「设置」语义的序列：
 * - `CSI c` / `CSI > c`            主/次设备属性查询（DA1/DA2）
 * - `CSI n`（6n）/ `CSI ? n`       光标位置查询（CPR/DECXCPR）
 * - `CSI t` 的 14/16/18            窗口像素尺寸、字符尺寸查询
 * - `CSI $ p` / `CSI ? $ p`        DECRQM 模式查询
 * - OSC 10/11/12 的 `?` 查询      前景/背景/光标色查询
 * - OSC 4 的 `?` 查询              调色板色查询
 * 刻意保留 `CSI 22/23 t`（标题栈）、OSC 10/11/12 的**设置**形式等非查询序列。
 */
const TERMINAL_QUERY_PATTERN = new RegExp(
  [
    /* DA1 / DA2：CSI c、CSI > c（可能带参） */
    "\\u001b\\[[?>]?[0-9;]*c",
    /* CPR / DECXCPR：CSI 6n、CSI ? 6n */
    "\\u001b\\[[?>]?[0-9;]*n",
    /* 窗口尺寸查询：CSI 14 t / 16 t / 18 t
       注意要同时覆盖「无第二参数」（CSI 14t）与「带第二参数」（CSI 14;2t）两种写法 */
    "\\u001b\\[1[468](?:;[0-9]*)?t",
    /* DECRQM 模式查询 */
    "\\u001b\\[[?>]?[0-9;]*\\$p",
    /* OSC 10/11/12 颜色查询（以 ? 结尾） */
    "\\u001b\\]1[0-2];\\?(?:\\u0007|\\u001b\\\\)",
    /* OSC 4 调色板查询（索引;?） */
    "\\u001b\\]4;[0-9]+;\\?(?:\\u0007|\\u001b\\\\)",
  ].join("|"),
  "g"
);

/** 去掉会触发终端自动应答的查询序列；其余可视内容与设置类序列原样保留 */
export function stripTerminalQueries(chunk: string): string {
  if (!chunk.includes("\u001b")) {
    return chunk;
  }
  return chunk.replace(TERMINAL_QUERY_PATTERN, "");
}

export function sendTerminalMessage(socket: WebSocket | null | undefined, payload: Record<string, unknown>) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function clearDetachTimer(state: TerminalSessionState) {
  if (state.detachTimer) {
    clearTimeout(state.detachTimer);
    state.detachTimer = null;
  }
}

function clearKeepaliveTimer(state: TerminalSessionState) {
  if (state.keepaliveTimer) {
    clearInterval(state.keepaliveTimer);
    state.keepaliveTimer = null;
  }
}

export function resetTerminalKeepalive(sessionId: string) {
  const state = terminalSessions.get(sessionId);
  if (!state) {
    return;
  }
  clearKeepaliveTimer(state);
  // SSH and WebSocket already have protocol-level keepalive. Do not write
  // invisible characters into the interactive shell: JumpServer may echo them.
}

export function appendTerminalTranscript(sessionId: string, chunk: Buffer | string) {
  const state = terminalSessions.get(sessionId);
  if (!state) {
    return;
  }
  /* 入档即剔除查询序列：transcript 只用于「回放」，回放时不能让 xterm 再次应答 */
  state.transcript += stripTerminalQueries(chunk.toString());
  if (state.transcript.length > MAX_TRANSCRIPT_CHARS) {
    state.transcript = state.transcript.slice(-MAX_TRANSCRIPT_CHARS);
  }
}

export function createTerminalSession(state: TerminalSessionState) {
  terminalSessions.set(state.sessionId, state);
  resetTerminalKeepalive(state.sessionId);
}

export function getTerminalSession(sessionId: string) {
  return terminalSessions.get(sessionId) ?? null;
}

export function attachTerminalSession(sessionId: string, socket: WebSocket) {
  const state = terminalSessions.get(sessionId);
  if (!state) {
    return null;
  }
  clearDetachTimer(state);
  if (state.socket && state.socket !== socket) {
    sendTerminalMessage(state.socket, { type: "detached", sessionId });
    state.socket.close();
  }
  state.socket = socket;
  return state;
}

export function detachTerminalSession(sessionId: string, socket: WebSocket) {
  const state = terminalSessions.get(sessionId);
  if (!state || state.socket !== socket) {
    return;
  }
  state.socket = null;
  clearDetachTimer(state);
  state.detachTimer = setTimeout(() => {
    destroyTerminalSession(sessionId, false);
  }, DETACHED_SESSION_TTL_MS);
}

export function destroyTerminalSession(sessionId: string, notify = true) {
  const state = terminalSessions.get(sessionId);
  if (!state) {
    return;
  }
  terminalSessions.delete(sessionId);
  clearDetachTimer(state);
  clearKeepaliveTimer(state);
  if (notify) {
    sendTerminalMessage(state.socket, { type: "closed", sessionId });
  }
  state.socket = null;
  state.cleanup();
}
