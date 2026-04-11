import type { LogSearchRequest, ServerSummary } from "@server-log-console/shared";
import { shellEscape } from "./remote-shell.js";

export function toIsoRange(request: LogSearchRequest) {
  if (request.startDate || request.endDate) {
    const startDate = request.startDate || request.endDate || "";
    const endDate = request.endDate || request.startDate || "";
    const startTime = request.startTime?.trim() || "00:00:00";
    const endTime = request.endTime?.trim() || "23:59:59";

    return {
      rangeStart: startDate ? `${startDate}T${startTime}` : "",
      rangeEnd: endDate ? `${endDate}T${endTime}` : ""
    };
  }

  if (request.date) {
    return {
      rangeStart: `${request.date}T00:00:00`,
      rangeEnd: `${request.date}T23:59:59`
    };
  }

  return {
    rangeStart: "",
    rangeEnd: ""
  };
}

function getSingleDayValue(request: LogSearchRequest) {
  const startDate = request.startDate?.trim() || request.date?.trim() || "";
  const endDate = request.endDate?.trim() || request.date?.trim() || "";

  if (startDate && endDate && startDate === endDate) {
    return startDate;
  }

  return "";
}

function buildSingleDayPrefixPattern(dayValue: string) {
  if (!dayValue) {
    return "";
  }

  const mdValue = dayValue.slice(5);
  return `^(${dayValue}|${mdValue} )`;
}

function buildFastSearchCommand(filePath: string, term: string, context: number, singleDayValue: string) {
  const dayPattern = buildSingleDayPrefixPattern(singleDayValue);

  if (!singleDayValue) {
    if (context <= 0) {
      const script = `LC_ALL=C grep -nF -- ${shellEscape(term)} ${shellEscape(filePath)} || true`;
      return `bash -lc ${shellEscape(script)}`;
    }

    const script = `LC_ALL=C grep -nF -C ${Math.max(0, context)} -- ${shellEscape(term)} ${shellEscape(filePath)} || true`;
    return `bash -lc ${shellEscape(script)}`;
  }

  if (context <= 0) {
    const script = `(LC_ALL=C grep -nE ${shellEscape(dayPattern)} ${shellEscape(filePath)} | LC_ALL=C grep -F -- ${shellEscape(term)}) || true`;
    return `bash -lc ${shellEscape(script)}`;
  }

  const script = [
    `file=${shellEscape(filePath)}`,
    `term=${shellEscape(term)}`,
    `context=${shellEscape(String(Math.max(0, context)))}`,
    `pattern=${shellEscape(dayPattern)}`,
    'tmp_hits=$(mktemp)',
    'LC_ALL=C grep -nE "$pattern" "$file" | LC_ALL=C grep -F -- "$term" | cut -d: -f1 | head -n 200 > "$tmp_hits"',
    'if [ ! -s "$tmp_hits" ]; then',
    '  rm -f "$tmp_hits"',
    "  exit 0",
    "fi",
    'ranges_file=$(mktemp)',
    'last_start=""',
    'last_end=""',
    'while IFS= read -r line_no; do',
    '  [ -z "$line_no" ] && continue',
    '  start=$(( line_no > context ? line_no - context : 1 ))',
    '  end=$(( line_no + context ))',
    '  if [ -n "$last_start" ] && [ "$start" -le $((last_end + 1)) ]; then',
    '    if [ "$end" -gt "$last_end" ]; then',
    '      last_end=$end',
    "    fi",
    "  else",
    '    if [ -n "$last_start" ]; then',
    '      printf "%s %s\\n" "$last_start" "$last_end" >> "$ranges_file"',
    "    fi",
    '    last_start=$start',
    '    last_end=$end',
    "  fi",
    'done < "$tmp_hits"',
    'if [ -n "$last_start" ]; then',
    '  printf "%s %s\\n" "$last_start" "$last_end" >> "$ranges_file"',
    "fi",
    'sed_args=""',
    'while IFS=" " read -r start end; do',
    '  [ -z "$start" ] && continue',
    '  sed_args="$sed_args -e ${start},${end}p"',
    'done < "$ranges_file"',
    'if [ -z "$sed_args" ]; then',
    '  rm -f "$tmp_hits" "$ranges_file"',
    "  exit 0",
    "fi",
    'eval "nl -ba \\"$file\\" | sed -n $sed_args" | awk -v file="$file" -F "\\t" \'{ sub(/^[[:space:]]+/, "", $1); print file ":" $1 ":" $2 }\'',
    'rm -f "$tmp_hits" "$ranges_file"'
  ].join("\n");

  return `bash -lc ${shellEscape(script)}`;
}

export function buildSearchCommand(server: ServerSummary, request: LogSearchRequest): string {
  const context = Number.isFinite(request.contextLines) ? Math.max(0, request.contextLines ?? 0) : 0;
  const filePath = request.filePath || `${server.basePath}/catalina.out`;
  const { rangeStart, rangeEnd } = toIsoRange(request);
  const singleDayValue = getSingleDayValue(request);
  const keywordTerms = (request.keywordTerms?.filter((item) => item.trim()) ?? []).map((item) => item.trim());
  const normalizedTerms = keywordTerms.length ? keywordTerms : request.keyword?.trim() ? [request.keyword.trim()] : [];

  if (!rangeStart && !rangeEnd && normalizedTerms.length === 0) {
    return `tail -n 200 ${shellEscape(filePath)}`;
  }

  const canUseFastPath =
    !request.useRegex &&
    (request.keywordMode || "phrase") === "phrase" &&
    normalizedTerms.length === 1 &&
    (!singleDayValue || (!request.startTime?.trim() && !request.endTime?.trim()));

  if (canUseFastPath) {
    return buildFastSearchCommand(filePath, normalizedTerms[0], context, singleDayValue);
  }

  const payload = {
    filePath,
    keywordMode: request.keywordMode || "phrase",
    contextLines: context,
    useRegex: Boolean(request.useRegex),
    rangeStart,
    rangeEnd,
    keywordTerms: normalizedTerms
  };

  const currentYear = new Date().getFullYear().toString();
  const awkVariables = [
    `-v file=${shellEscape(filePath)}`,
    `-v context=${shellEscape(String(payload.contextLines))}`,
    `-v keyword_mode=${shellEscape(payload.keywordMode)}`,
    `-v use_regex=${shellEscape(payload.useRegex ? "1" : "0")}`,
    `-v range_start=${shellEscape(payload.rangeStart)}`,
    `-v range_end=${shellEscape(payload.rangeEnd)}`,
    `-v term_count=${shellEscape(String(payload.keywordTerms.length))}`,
    `-v currentYear=${shellEscape(currentYear)}`
  ];

  payload.keywordTerms.forEach((term, index) => {
    awkVariables.push(`-v term_${index + 1}=${shellEscape(term)}`);
  });
  const termAssignments = payload.keywordTerms.map((_, index) => `  terms[${index + 1}] = term_${index + 1};`);

  const script = [
    `AWK_BIN=$(command -v mawk 2>/dev/null || echo awk)`,
    `LC_ALL=C $AWK_BIN ${awkVariables.join(" ")} '`,
    "BEGIN {",
    ...termAssignments,
    "  termsCount = term_count + 0;",
    "  context += 0;",
    "  pendingAfter = 0; lastPrinted = 0;",
    "}",
    "function normalizeTime(line,   ts) {",
    "  if (match(line, /^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}/)) {",
    "    ts = substr(line, RSTART, 19); gsub(/ /, \"T\", ts); return ts;",
    "  }",
    "  if (match(line, /^[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}/)) {",
    "    ts = currentYear \"-\" substr(line, RSTART, 5) \"T\" substr(line, RSTART + 6, 8); return ts;",
    "  }",
    "  return \"\";",
    "}",
    "function keywordHit(line,   i, ok, found) {",
    "  if (termsCount == 0) return 1;",
    "  if (keyword_mode == \"phrase\") {",
    "    if (useRegex) return line ~ terms[1];",
    "    return index(line, terms[1]) > 0;",
    "  }",
    "  if (keyword_mode == \"all\") {",
    "    for (i = 1; i <= termsCount; i++) {",
    "      found = useRegex ? (line ~ terms[i]) : (index(line, terms[i]) > 0);",
    "      if (!found) return 0;",
    "    }",
    "    return 1;",
    "  }",
    "  for (i = 1; i <= termsCount; i++) {",
    "    found = useRegex ? (line ~ terms[i]) : (index(line, terms[i]) > 0);",
    "    if (found) return 1;",
    "  }",
    "  return 0;",
    "}",
    "function inRange(line,   ts) {",
    "  if (range_start == \"\" && range_end == \"\") return 1;",
    "  ts = normalizeTime(line);",
    "  if (ts == \"\") return 0;",
    "  if (range_start != \"\" && ts < range_start) return 0;",
    "  if (range_end != \"\" && ts > range_end) return 0;",
    "  return 1;",
    "}",
    "{",
    "  line = $0;",
    "  hit = inRange(line) && keywordHit(line);",
    "  if (hit) {",
    "    if (context > 0) {",
    "      start = NR - context; if (start < 1) start = 1;",
    "      for (i = start; i < NR; i++) {",
    "        if (bufLine[i] != \"\" && lastPrinted != i) {",
    "          print file \":\" i \":\" bufLine[i];",
    "          lastPrinted = i;",
    "        }",
    "      }",
    "    }",
    "    print file \":\" NR \":\" line;",
    "    lastPrinted = NR;",
    "    pendingAfter = context;",
    "  } else if (pendingAfter > 0 && lastPrinted != NR) {",
    "    print file \":\" NR \":\" line;",
    "    lastPrinted = NR;",
    "    pendingAfter--;",
    "  }",
    "  if (context > 0) { bufLine[NR] = line; delete bufLine[NR - context - 1]; }",
    "}",
    "END {",
    "  if (context > 0) {",
    "    for (i in bufLine) {",
    "      print file \":\" i \":\" bufLine[i];",
    "    }",
    "  }",
    "}' " + shellEscape(filePath)
  ].join("\n");

  return `bash -lc ${shellEscape(script)}`;
}

export function buildStreamingSearchCommand(server: ServerSummary, request: LogSearchRequest, totalBytes = 0): string {
  const context = Number.isFinite(request.contextLines) ? Math.max(0, request.contextLines ?? 0) : 0;
  const filePath = request.filePath || `${server.basePath}/catalina.out`;
  const { rangeStart, rangeEnd } = toIsoRange(request);
  const keywordTerms = (request.keywordTerms?.filter((item) => item.trim()) ?? []).map((item) => item.trim());
  const normalizedTerms = keywordTerms.length ? keywordTerms : request.keyword?.trim() ? [request.keyword.trim()] : [];
  const hasDateRange = Boolean(rangeStart || rangeEnd);

  const currentYear = new Date().getFullYear().toString();
  const awkVariables = [
    `-v file=${shellEscape(filePath)}`,
    `-v context=${shellEscape(String(context))}`,
    `-v keyword_mode=${shellEscape(request.keywordMode || "phrase")}`,
    `-v use_regex=${shellEscape(request.useRegex ? "1" : "0")}`,
    `-v term_count=${shellEscape(String(normalizedTerms.length))}`,
    `-v total_bytes=${shellEscape(String(totalBytes))}`
  ];

  if (hasDateRange) {
    awkVariables.push(
      `-v range_start=${shellEscape(rangeStart)}`,
      `-v range_end=${shellEscape(rangeEnd)}`,
      `-v currentYear=${shellEscape(currentYear)}`
    );
  }

  normalizedTerms.forEach((term, index) => {
    awkVariables.push(`-v term_${index + 1}=${shellEscape(term)}`);
  });

  const termAssignments = normalizedTerms.map((_, index) => `  terms[${index + 1}] = term_${index + 1};`);

  const dateRangeFunctions = hasDateRange ? [
    "function normalizeTime(line,   ts) {",
    "  if (match(line, /^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}/)) {",
    "    ts = substr(line, RSTART, 19); gsub(/ /, \"T\", ts); return ts;",
    "  }",
    "  if (match(line, /^[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}/)) {",
    "    ts = currentYear \"-\" substr(line, RSTART, 5) \"T\" substr(line, RSTART + 6, 8); return ts;",
    "  }",
    "  return \"\";",
    "}",
    "function inRange(line,   ts) {",
    "  ts = normalizeTime(line);",
    "  if (ts == \"\") return 0;",
    "  if (range_start != \"\" && ts < range_start) return 0;",
    "  if (range_end != \"\" && ts > range_end) return 0;",
    "  return 1;",
    "}"
  ] : [];

  const hitExpression = hasDateRange
    ? "keywordHit(line) && inRange(line)"
    : "keywordHit(line)";

  const script = [
    `AWK_BIN=$(command -v mawk 2>/dev/null || echo awk)`,
    `LC_ALL=C $AWK_BIN ${awkVariables.join(" ")} '`,
    "BEGIN {",
    ...termAssignments,
    "  termsCount = term_count + 0;",
    "  context += 0;",
    "  pendingAfter = 0;",
    "  lastPrinted = 0;",
    "  scannedBytes = 0;",
    "  lastReported = 0;",
    "  tb = total_bytes + 0;",
    "  reportStep = 1024;",
    "  if (tb > 0 && int(tb / 50) > 1024) reportStep = int(tb / 50);",
    "}",
    ...dateRangeFunctions,
    "function keywordHit(line,   i, found) {",
    "  if (termsCount == 0) return 1;",
    "  if (keyword_mode == \"phrase\") {",
    "    if (use_regex) return line ~ terms[1];",
    "    return index(line, terms[1]) > 0;",
    "  }",
    "  if (keyword_mode == \"all\") {",
    "    for (i = 1; i <= termsCount; i++) {",
    "      found = use_regex ? (line ~ terms[i]) : (index(line, terms[i]) > 0);",
    "      if (!found) return 0;",
    "    }",
    "    return 1;",
    "  }",
    "  for (i = 1; i <= termsCount; i++) {",
    "    found = use_regex ? (line ~ terms[i]) : (index(line, terms[i]) > 0);",
    "    if (found) return 1;",
    "  }",
    "  return 0;",
    "}",
    "function emitProgress() {",
    "  printf \"__PROGRESS__\\t%d\\t%d\\t%d\\t%d\\n\", scannedBytes, NR, lastReported + 1, scannedBytes;",
    "  fflush();",
    "  lastReported = scannedBytes;",
    "}",
    "{",
    "  line = $0;",
    "  scannedBytes += length(line) + 1;",
    `  hit = ${hitExpression};`,
    "  if (hit) {",
    "    if (context > 0) {",
    "      start = NR - context; if (start < 1) start = 1;",
    "      for (i = start; i < NR; i++) {",
    "        if ((i in bufLine) && lastPrinted != i) {",
    "          printf \"__CTX__\\t%d\\t%s\\n\", i, bufLine[i];",
    "          lastPrinted = i;",
    "        }",
    "      }",
    "    }",
    "    printf \"__MATCH__\\t%d\\t%s\\n\", NR, $0;",
    "    fflush();",
    "    lastPrinted = NR;",
    "    pendingAfter = context;",
    "  } else if (pendingAfter > 0 && lastPrinted != NR) {",
    "    printf \"__CTX__\\t%d\\t%s\\n\", NR, $0;",
    "    lastPrinted = NR;",
    "    pendingAfter--;",
    "  }",
    "  if (context > 0) { bufLine[NR] = $0; delete bufLine[NR - context - 1]; }",
    "  if (NR == 1 || scannedBytes - lastReported >= reportStep) emitProgress();",
    "}",
    "END {",
    "  if (scannedBytes != lastReported) emitProgress();",
    "}' " + shellEscape(filePath)
  ].join("\n");

  return `bash -lc ${shellEscape(script)}`;
}

export function buildTailCommand(filePath: string, keyword?: string): string {
  const fileArg = shellEscape(filePath);

  if (!keyword) {
    return `tail -F ${fileArg}`;
  }

  const script = `tail -F ${filePath} | grep --line-buffered -nH ${shellEscape(keyword)}`;
  return `bash -lc ${shellEscape(script)}`;
}
