import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import "./fonts.css";
import "./styles.css";
import "./theme-modern.css";
import "./theme-modern-v2.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
