export function ToolIcon({ kind }: { kind: "search" | "tail" | "files" | "more" | "open" | "refresh" | "filter" | "settings" | "terminal" }) {
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
  }
}
