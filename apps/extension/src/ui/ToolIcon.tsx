import {
  Search,
  ArrowDownToLine,
  ArrowUpDown,
  FileText,
  SlidersHorizontal,
  FolderUp,
  FolderOpen,
  RefreshCw,
  Filter,
  Settings,
  TerminalSquare,
  Sparkles,
  Undo2,
  History,
  Download,
  Upload,
  Trash2,
  Pencil,
  FolderPlus,
} from "lucide-react";

type IconKind = "search" | "tail" | "files" | "more" | "open" | "refresh" | "filter" | "highlight" | "context" | "settings" | "terminal" | "sparkle" | "undo" | "history" | "transfer" | "download" | "upload" | "delete" | "rename" | "folder" | "folder-plus";

export function ToolIcon({ kind, theme }: { kind: IconKind; theme?: "classic" | "modern" }) {
  if (theme === "modern") return <ModernIcon kind={kind} />;
  return <ClassicIcon kind={kind} />;
}

function ClassicIcon({ kind }: { kind: IconKind }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true
  };

  switch (kind) {
    case "search":
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.5 10.5L14 14" />
        </svg>
      );
    case "tail":
      return (
        <svg {...common}>
          <path d="M8 2.5V12" />
          <path d="M4.5 8.5L8 12L11.5 8.5" />
        </svg>
      );
    case "files":
      return (
        <svg {...common}>
          <path d="M2.5 3.5H13.5V12.5H2.5z" />
          <path d="M2.5 6H13.5" />
          <path d="M5.5 3.5V12.5" />
        </svg>
      );
    case "more":
      return (
        <svg {...common}>
          <circle cx="3.5" cy="8" r="1" fill="currentColor" stroke="none" />
          <circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" />
          <circle cx="12.5" cy="8" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case "open":
      return (
        <svg {...common}>
          <path d="M2.2 5.5H6.4L7.6 6.8H13.6V12.6H2.2z" />
          <path d="M8.8 9.4H4.8" />
          <path d="M6.4 7.8L4.8 9.4L6.4 11" />
        </svg>
      );
    case "refresh":
      return (
        <svg {...common}>
          <path d="M12.5 5.5V2.8H9.8" />
          <path d="M12 3.2A5.4 5.4 0 1 0 13.3 9" />
        </svg>
      );
    case "filter":
      return (
        <svg {...common}>
          <path d="M2.5 3.5H13.5" />
          <path d="M5.5 8H10.5" />
          <path d="M7 12.5H9" />
        </svg>
      );
    case "highlight":
      return (
        <svg {...common} strokeWidth={1.15}>
          <rect x="2.45" y="3.3" width="11.1" height="9.4" rx="2.25" />
          <text x="8" y="9.4" textAnchor="middle" fontSize="4.15" fontWeight="700" textLength="7.4" lengthAdjust="spacingAndGlyphs" fill="currentColor" stroke="none" fontFamily="sans-serif">ERR</text>
        </svg>
      );
    case "context":
      return (
        <svg {...common}>
          <path d="M3 3.5H13" />
          <path d="M5 6.5H11" />
          <path d="M3 9.5H13" />
          <path d="M3 12.5H13" opacity="0.7" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="2.2" />
          <path d="M8 2.4V4" />
          <path d="M8 12V13.6" />
          <path d="M13.6 8H12" />
          <path d="M4 8H2.4" />
          <path d="M11.95 4.05L10.8 5.2" />
          <path d="M5.2 10.8L4.05 11.95" />
          <path d="M11.95 11.95L10.8 10.8" />
          <path d="M5.2 5.2L4.05 4.05" />
        </svg>
      );
    case "terminal":
      return (
        <svg {...common}>
          <path d="M2.2 3.4H13.8V12.6H2.2z" />
          <path d="M4.4 6.3L6.6 8L4.4 9.7" />
          <path d="M7.7 9.8H11.5" />
        </svg>
      );
    case "sparkle":
      return (
        <svg {...common}>
          <path d="M8 2L9.2 6.8L14 8L9.2 9.2L8 14L6.8 9.2L2 8L6.8 6.8Z" />
        </svg>
      );
    case "undo":
      return (
        <svg {...common}>
          <path d="M3.5 5.5V2.8H6.2" />
          <path d="M4 3.2A5.4 5.4 0 1 1 2.7 9" />
        </svg>
      );
    case "history":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="5.5" />
          <path d="M8 4.5V8L10.5 10" />
        </svg>
      );
    case "transfer":
      return (
        <svg {...common}>
          <path d="M4 5.2H12" />
          <path d="M9.6 2.8L12 5.2L9.6 7.6" />
          <path d="M12 10.8H4" />
          <path d="M6.4 8.4L4 10.8L6.4 13.2" />
        </svg>
      );
    case "download":
      return (
        <svg {...common}>
          <path d="M8 2.5V10" />
          <path d="M4.5 7L8 10.5L11.5 7" />
          <path d="M3 13H13" />
        </svg>
      );
    case "upload":
      return (
        <svg {...common}>
          <path d="M8 10.5V3" />
          <path d="M4.5 6L8 2.5L11.5 6" />
          <path d="M3 13H13" />
        </svg>
      );
    case "delete":
      return (
        <svg {...common}>
          <path d="M4 4.5H12" />
          <path d="M6.5 4.5V3.2H9.5V4.5" />
          <path d="M5 4.5L5.5 13H10.5L11 4.5" />
          <path d="M7 7V10.5" />
          <path d="M9 7V10.5" />
        </svg>
      );
    case "rename":
      return (
        <svg {...common}>
          <path d="M4 12.5L10.5 3.5L13 6L6.5 15H4V12.5Z" />
          <path d="M9 5L11.5 7.5" />
        </svg>
      );
    case "folder":
      return (
        <svg {...common}>
          <path d="M2.2 5H6.2L7.5 6.3H13.8V12.8H2.2z" />
          <path d="M2.2 5V3.2H6.2L7.5 4.5" />
        </svg>
      );
    case "folder-plus":
      return (
        <svg {...common}>
          <path d="M2.2 5H6.2L7.5 6.3H13.8V12.8H2.2z" />
          <path d="M8 8.2V11.5" />
          <path d="M6.3 9.8H9.7" />
        </svg>
      );
  }
}

const LUCIDE_PROPS = { size: 16, strokeWidth: 1.8, "aria-hidden": true } as const;

function ModernIcon({ kind }: { kind: IconKind }) {
  switch (kind) {
    case "search":
      return <Search {...LUCIDE_PROPS} />;
    case "tail":
      return <ArrowDownToLine {...LUCIDE_PROPS} />;
    case "files":
      return <FileText {...LUCIDE_PROPS} />;
    case "more":
      return <SlidersHorizontal {...LUCIDE_PROPS} />;
    case "open":
      return <FolderUp {...LUCIDE_PROPS} />;
    case "refresh":
      return <RefreshCw {...LUCIDE_PROPS} />;
    case "filter":
      return <Filter {...LUCIDE_PROPS} />;
    case "highlight":
      return (
        <svg {...LUCIDE_PROPS} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.35} strokeLinecap="round" strokeLinejoin="round">
          <rect x="2.4" y="3.25" width="11.2" height="9.5" rx="2.3" />
          <text x="8" y="9.45" textAnchor="middle" fontSize="4.2" fontWeight="700" textLength="7.5" lengthAdjust="spacingAndGlyphs" fill="currentColor" stroke="none" fontFamily="sans-serif">ERR</text>
        </svg>
      );
    case "context":
      return (
        <svg {...LUCIDE_PROPS} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 3.5H13" />
          <path d="M5 6.5H11" />
          <path d="M3 9.5H13" />
          <path d="M3 12.5H13" opacity="0.7" />
        </svg>
      );
    case "settings":
      return <Settings {...LUCIDE_PROPS} />;
    case "terminal":
      return <TerminalSquare {...LUCIDE_PROPS} />;
    case "sparkle":
      return <Sparkles {...LUCIDE_PROPS} />;
    case "undo":
      return <Undo2 {...LUCIDE_PROPS} />;
    case "history":
      return <History {...LUCIDE_PROPS} />;
    case "transfer":
      return <ArrowUpDown {...LUCIDE_PROPS} />;
    case "download":
      return <Download {...LUCIDE_PROPS} />;
    case "upload":
      return <Upload {...LUCIDE_PROPS} />;
    case "delete":
      return <Trash2 {...LUCIDE_PROPS} />;
    case "rename":
      return <Pencil {...LUCIDE_PROPS} />;
    case "folder":
      return <FolderOpen {...LUCIDE_PROPS} />;
    case "folder-plus":
      return <FolderPlus {...LUCIDE_PROPS} />;
  }
}
