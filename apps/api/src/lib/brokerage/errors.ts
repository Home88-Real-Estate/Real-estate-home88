import type { DocumentCompletenessResult } from "@home88/domain";

/** A rule of the brokerage workflow was not met. Carries a stable code; the message is Greek, for the agent. */
export class BrokerageError extends Error {
  constructor(readonly code: string, message: string, readonly details?: unknown) {
    super(message);
    this.name = "BrokerageError";
  }
}

/** The document has blocking issues and cannot move to the requested state. */
export class DocumentBlockedError extends BrokerageError {
  constructor(readonly result: DocumentCompletenessResult) {
    super("DOCUMENT_BLOCKED", `Το έγγραφο δεν είναι έτοιμο: ${result.blockingIssues.map((i) => i.message).join(" ")}`, result);
    this.name = "DocumentBlockedError";
  }
}
