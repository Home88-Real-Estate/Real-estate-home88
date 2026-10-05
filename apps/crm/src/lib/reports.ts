/** Formatting for report values. A missing value is a dash, never a zero. */

const number = new Intl.NumberFormat("el-GR", { maximumFractionDigits: 2 });
const money = new Intl.NumberFormat("el-GR", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
const wholeMoney = new Intl.NumberFormat("el-GR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

export type ReportMetricValue = string | number | null;

export function formatMetric(value: ReportMetricValue, unit?: string | null): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (unit === "€") return (Number.isInteger(value) ? wholeMoney : money).format(value);
  if (unit === "%") return `${number.format(value)}%`;
  if (unit === "ημ.") return `${number.format(value)} ημ.`;
  return number.format(value);
}

export function formatCell(value: ReportMetricValue): string {
  if (value === null || value === undefined) return "—";
  return typeof value === "number" ? number.format(value) : value;
}

export type ReportTable = { key: string; title: string; columns: Array<{ key: string; label: string; numeric?: boolean }>; rows: Array<Record<string, ReportMetricValue>> };
export type Report = {
  kind: string;
  title: string;
  period: { key: string; from: string; to: string };
  scope: "mine" | "all";
  definitions: string[];
  summary: Array<{ key: string; label: string; value: ReportMetricValue; unit?: string | null }>;
  tables: ReportTable[];
  truncated: boolean;
};
