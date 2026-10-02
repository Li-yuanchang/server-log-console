// 原型 S11「弹出/收回独立小窗」统一图标。
// 形态对齐参考图：外框 + 左上向右下的撇线（弹出动势）+ 右下内嵌的实心小窗。
// 全站弹出小窗入口共用：日志动作组 / 日志小窗头部 / 终端工具行 / 占位页。
export function PipExpandIcon({ size = 14, strokeWidth = 1.8 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {/* 左上开口 + 向右下的撇线（弹出/缩放到独立窗口的动势） */}
      <path d="M2 10h6V4" />
      <path d="m2 4 6 6" />
      {/* 外框右上 / 左下 */}
      <path d="M21 10V7a2 2 0 0 0-2-2h-7" />
      <path d="M3 14v2a2 2 0 0 0 2 2h3" />
      {/* 右下内嵌小窗：实心（对齐参考图，空心描边在 14px 下会被误读成缺口） */}
      <rect x="12" y="14" width="10" height="7" rx="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
