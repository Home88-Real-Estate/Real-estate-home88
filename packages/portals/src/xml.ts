/** Minimal, dependency-free XML serialisation. */

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function renderAttrs(attrs?: Record<string, string | number | boolean>): string {
  if (!attrs) return "";
  return Object.entries(attrs)
    .map(([key, value]) => ` ${key}="${escapeXml(String(value))}"`)
    .join("");
}

/** `<name>value</name>`, or an empty string when there is nothing to render. */
export function element(
  name: string,
  value: string | number | boolean | null | undefined,
  attrs?: Record<string, string | number | boolean>,
): string {
  if (value === null || value === undefined || value === "") return "";
  return `<${name}${renderAttrs(attrs)}>${escapeXml(String(value))}</${name}>`;
}

/** `<name>…children…</name>`, omitted entirely when there are no children. */
export function block(
  name: string,
  children: Array<string | null | undefined | false>,
  attrs?: Record<string, string | number | boolean>,
): string {
  const present = children.filter((child): child is string => Boolean(child && child.length > 0));
  if (present.length === 0) return "";
  return [`<${name}${renderAttrs(attrs)}>`, ...present, `</${name}>`].join("\n");
}

/** Indents every non-empty line by `spaces`. */
export function indentLines(lines: string[], spaces = 2): string[] {
  const pad = " ".repeat(spaces);
  return lines.map((line) => (line.length > 0 ? pad + line : line));
}

/** Drops empty entries produced by conditional `element()` calls. */
export function compact(lines: Array<string | null | undefined | false>): string[] {
  return lines.filter((line): line is string => Boolean(line && line.length > 0));
}
