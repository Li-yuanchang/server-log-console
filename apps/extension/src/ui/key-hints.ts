/**
 * 键位提示的平台适配（2026-10-23）。
 *
 * 背景：界面里的快捷键提示全部按 macOS 习惯写成 `⌘K` / `⌘⇧V` 这类符号，
 * 但 Windows/Linux 上 ⌘ 并不存在，用户看到会困惑（用户反馈「wind 右上角这个
 * 符号是 macos 的吧，是不是得换换」）。
 *
 * 方案：源码里继续沿用 mac 写法（可读性好、与原型一致），**渲染时**统一过
 * formatKeyHint() 转成当前平台写法。这样只改渲染点、不动文案源，也不影响
 * 任何快捷键的实际注册逻辑（注册用的是 event.metaKey || event.ctrlKey，本就跨平台）。
 */

/** 当前是否 macOS。判定与 useElectronEnv 保持一致，避免两处给出不同结论。 */
export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  return navigator.userAgent.includes("Mac") || navigator.platform.toUpperCase().includes("MAC");
}

/**
 * 把 macOS 键位写法转成当前平台写法：
 *   ⌘ → Ctrl+ ｜ ⇧ → Shift+ ｜ ⌥ → Alt+ ｜ ⌫ → Backspace ｜ Cmd → Ctrl
 * 非 macOS 平台才转换；macOS 原样返回（保持 ⌘ 符号）。
 */
export function formatKeyHint(hint: string): string {
  if (!hint || isMacPlatform()) {
    return hint;
  }
  return hint
    .replace(/⌘/g, "Ctrl+")
    .replace(/⇧/g, "Shift+")
    .replace(/⌥/g, "Alt+")
    .replace(/⌫/g, "Backspace")
    .replace(/Cmd\+/g, "Ctrl+")
    .replace(/\bCmd\b/g, "Ctrl");
}
