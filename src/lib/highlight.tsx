import type { ReactNode } from "react";

const KEYWORDS = new Set([
  "import", "export", "from", "default", "function", "return", "async", "await", "if", "else",
  "for", "while", "switch", "case", "break", "continue", "class", "extends", "implements",
  "interface", "type", "enum", "new", "try", "catch", "finally", "throw", "const", "let", "var",
  "delete", "typeof", "instanceof", "in", "of", "do", "yield", "this", "super", "static", "public",
  "private", "protected", "readonly", "abstract", "void", "null", "undefined", "true", "false",
  "def", "class", "lambda", "pass", "elif", "with", "as", "assert", "raise", "except", "global",
  "package", "import", "func", "go", "chan", "defer", "struct", "interface", "map", "range",
  "select", "match", "case", "fn", "mut", "impl", "trait", "pub", "use", "mod", "crate", "self",
  "namespace", "template", "typename", "using", "public", "private", "protected", "virtual",
  "override", "final", "operator", "new", "delete", "sizeof", "throw", "catch",
]);

const TOKEN_PATTERN = new RegExp(
  [
    "(?<comment>//[^\\n]*|/\\*[\\s\\S]*?\\*/)",
    "(?<string>\"(?:\\\\.|[^\"\\\\])*\"|'(?:\\\\.|[^'\\\\])*'|`(?:\\\\.|[^`\\\\])*`)",
    "(?<number>\\b0[xXbBoO][0-9a-fA-F_]+\\b|\\b\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?n?\\b)",
    "(?<word>[A-Za-z_$][\\w$]*)",
    "(?<punct>[{}()\\[\\].,;:!?<>=+\\-*/%&|^~]+)",
  ].join("|"),
  "g",
);

function tokenClass(token: string, groups: Record<string, string | undefined>): string | null {
  if (groups.comment) return "tok-comment";
  if (groups.string) return "tok-string";
  if (groups.number) return "tok-number";
  if (groups.punct) return "tok-punct";
  if (groups.word) {
    if (KEYWORDS.has(token)) return "tok-keyword";
    if (/^[A-Z]/.test(token)) return "tok-type";
    const next = token;
    return /^[a-z_$][\w$]*$/.test(next) ? "tok-func" : null;
  }
  return null;
}

/**
 * Splits one line of code into Monokai-coloured spans.
 *
 * A regex scanner, not a parser: it recognises comments, strings, numbers, keywords,
 * capitalised identifiers and punctuation, which covers the visual signal that
 * matters in a source preview. It is not correct for template-literal interpolation
 * or regex literals, and it does not need to be — this renders code the user did not
 * write, read-only, inside a fixed-width drawer.
 *
 * `highlightCode` returns one array per line so callers can render line gutters.
 */
export function highlightLine(line: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  TOKEN_PATTERN.lastIndex = 0;
  while ((match = TOKEN_PATTERN.exec(line)) !== null) {
    const groups = match.groups ?? {};
    const token = match[0];
    if (match.index > lastIndex) nodes.push(line.slice(lastIndex, match.index));

    const className = tokenClass(token, groups);
    nodes.push(
      className ? (
        <span key={`${match.index}-${token}`} className={className}>
          {token}
        </span>
      ) : (
        token
      ),
    );
    lastIndex = match.index + token.length;
  }

  if (lastIndex < line.length) nodes.push(line.slice(lastIndex));
  return nodes;
}

export function highlightCode(code: string): ReactNode[][] {
  return code.split("\n").map(highlightLine);
}