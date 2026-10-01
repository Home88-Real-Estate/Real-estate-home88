/** RFC 4180 CSV serialisation. */

export function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toCsvRow(fields: Array<string | number | boolean | null | undefined>): string {
  return fields
    .map((field) => escapeCsvField(field === null || field === undefined ? "" : String(field)))
    .join(",");
}

export function toBoolFlag(value: boolean): string {
  return value ? "1" : "0";
}
