import { LEAD_STATUS_LABELS, PROPERTY_STATUS_LABELS, label } from "@home88/types";

type Kind = "property" | "lead" | "portal";

const PORTAL_LABELS: Record<string, string> = {
  NOT_PUBLISHED: "Not published",
  QUEUED: "Queued",
  PUBLISHING: "Publishing",
  PUBLISHED: "Published",
  FAILED: "Failed",
  REMOVED: "Removed",
  OUTDATED: "Outdated",
};

function classFor(kind: Kind, value: string): string {
  if (kind === "property") {
    switch (value) {
      case "ACTIVE":
      case "RESERVED":
        return "badge--ok";
      case "SOLD":
      case "RENTED":
        return "badge--info";
      case "INACTIVE":
        return "badge--warn";
      case "DRAFT":
      case "ARCHIVED":
        return "badge--muted";
      default:
        return "";
    }
  }

  if (kind === "lead") {
    switch (value) {
      case "WON":
        return "badge--ok";
      case "LOST":
      case "NOT_INTERESTED":
        return "badge--danger";
      case "NEW":
        return "badge--info";
      case "CONTACTED":
      case "QUALIFIED":
      case "VIEWING":
      case "OFFER":
        return "badge--warn";
      default:
        return "";
    }
  }

  switch (value) {
    case "PUBLISHED":
      return "badge--ok";
    case "FAILED":
      return "badge--danger";
    case "QUEUED":
    case "PUBLISHING":
    case "OUTDATED":
      return "badge--warn";
    default:
      return "badge--muted";
  }
}

function labelFor(kind: Kind, value: string): string {
  if (kind === "property") return label(PROPERTY_STATUS_LABELS, value, "el");
  if (kind === "lead") return label(LEAD_STATUS_LABELS, value, "el");
  return PORTAL_LABELS[value] ?? value;
}

export function StatusBadge({ value, kind }: { value: string; kind: Kind }) {
  return <span className={`badge ${classFor(kind, value)}`}>{labelFor(kind, value)}</span>;
}
