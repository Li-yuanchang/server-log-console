import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import "./fonts.css";
import "./styles.css";
import "./theme-modern.css";
import "./theme-modern-v2.css";
// 原型 1:1 对齐批次（隔离文件，最后加载以覆盖旧规则）
import "./align-s5-terminal.css";
import "./align-s7-s8.css";
import "./align-s9-monitor.css";
import "./align-s4-s6.css";
import "./align-s10-s14.css";
// 内嵌日志/切片查看区改浅色（对齐原型 S1/S3/S4；勿影响 S7 弹窗/终端/PiP 的深色）
import "./align-log-light.css";
// 选中态统一：tab/分段/胶囊 = 无实底 + accent 文字（用户决策 2026-09-30）
import "./align-selected.css";
// 控件统一：深色表面按钮护栏 + 「检索│LIVE」竖线（用户决策 2026-09-30）
import "./align-controls.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
