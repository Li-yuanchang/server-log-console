export type LogHighlightKind = "fatal" | "exception" | "error" | "warning";

type LogHighlightRule = {
  kind: LogHighlightKind;
  patterns: RegExp[];
};

type DeclaredLogLevel = LogHighlightKind | "neutral";

const LOG_HIGHLIGHT_RULES: LogHighlightRule[] = [
  {
    kind: "fatal",
    patterns: [
      /\b(?:fatal|panic|critical|abort(?:ed)?|segmentation fault|assert(?:ion)? failed|out of memory|oom(?: killer)?|core dumped)\b/i,
    ],
  },
  {
    kind: "exception",
    patterns: [
      /\b(?:exception|traceback|caused by:|stack trace|unhandled(?: rejection| exception)?|TypeError|ReferenceError|SyntaxError|RangeError|RuntimeError|ValueError|KeyError|ImportError|IOError|OSError|NullPointerException|IllegalStateException|SQLException)\b/i,
      /^\s+at\s+\S+/i,
      /^\s*File ".*", line \d+/i,
      /^\s*\.\.\. \d+ more$/i,
    ],
  },
  {
    kind: "error",
    patterns: [
      /\b(?:error|err|failed|failure|denied|forbidden|unauthorized|timeout|timed out|connection reset|connection refused|broken pipe|no such file|permission denied)\b/i,
      /\b(?:unable|cannot)\s+(?:to\s+)?(?:connect|open|read|write|load|start|create|resolve|find|access|bind)\b/i,
    ],
  },
  {
    kind: "warning",
    patterns: [
      /\b(?:warn(?:ing)?|deprecated|deprecation|retry(?:ing)?|backoff|slow query)\b/i,
    ],
  },
];

function detectDeclaredLogLevel(line: string): DeclaredLogLevel | null {
  const header = line.slice(0, 160);
  if (/\bFATAL\b/i.test(header)) {
    return "fatal";
  }
  if (/\bERROR\b/i.test(header)) {
    return "error";
  }
  if (/\bWARN(?:ING)?\b/i.test(header)) {
    return "warning";
  }
  if (/\b(?:DEBUG|INFO|TRACE)\b/i.test(header)) {
    return "neutral";
  }
  return null;
}

export function detectLogHighlightKind(line: string): LogHighlightKind | null {
  if (!line.trim()) {
    return null;
  }

  const fatalRule = LOG_HIGHLIGHT_RULES[0];
  const exceptionRule = LOG_HIGHLIGHT_RULES[1];
  const errorRule = LOG_HIGHLIGHT_RULES[2];
  const warningRule = LOG_HIGHLIGHT_RULES[3];

  if (fatalRule?.patterns.some((pattern) => pattern.test(line))) {
    return "fatal";
  }

  if (exceptionRule?.patterns.some((pattern) => pattern.test(line))) {
    return "exception";
  }

  const declaredLevel = detectDeclaredLogLevel(line);
  if (declaredLevel === "fatal" || declaredLevel === "error" || declaredLevel === "warning") {
    return declaredLevel;
  }

  if (declaredLevel === "neutral") {
    return null;
  }

  if (errorRule?.patterns.some((pattern) => pattern.test(line))) {
    return "error";
  }

  if (warningRule?.patterns.some((pattern) => pattern.test(line))) {
    return "warning";
  }

  return null;
}
