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
  state.transcript += chunk.toString();
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
