/**
 * Strict CSV staging parser for legacy imports.
 *
 * This parser intentionally knows nothing about Estate+ field names. The
 * supplier's schema must be established from a real export before mapping.
 * Values are returned as raw cells and must be encrypted before persistence.
 */

export const LEGACY_CSV_PARSER_VERSION = "home88-csv-v1";

export type LegacyCsvDelimiter = "," | ";" | "\t";
export type LegacyCsvDelimiterChoice = "AUTO" | "COMMA" | "SEMICOLON" | "TAB";

export type LegacyCsvIssue = {
  code: "COLUMN_COUNT_MISMATCH";
  expectedColumns: number;
  actualColumns: number;
};

export type LegacyCsvRow = {
  /** Logical CSV record number, including the header record as row 1. */
  rowNumber: number;
  values: string[];
  issues: LegacyCsvIssue[];
};

export type ParsedLegacyCsv = {
  headers: string[];
  delimiter: LegacyCsvDelimiter;
  rows: LegacyCsvRow[];
};

export class LegacyCsvError extends Error {
  constructor(
    readonly code:
      | "EMPTY_FILE"
      | "FILE_TOO_LARGE"
      | "NULL_BYTE"
      | "UNTERMINATED_QUOTE"
      | "INVALID_QUOTE"
      | "TOO_MANY_ROWS"
      | "TOO_MANY_COLUMNS"
      | "FIELD_TOO_LONG"
      | "EMPTY_HEADER"
      | "DUPLICATE_HEADER"
      | "NO_DATA_ROWS",
    message: string,
  ) {
    super(message);
    this.name = "LegacyCsvError";
  }
}

export type LegacyCsvOptions = {
  delimiter?: LegacyCsvDelimiterChoice;
  maxBytes?: number;
  maxRows?: number;
  maxColumns?: number;
  maxCellChars?: number;
};

const DEFAULTS = {
  maxBytes: 20 * 1024 * 1024,
  maxRows: 20_000,
  maxColumns: 200,
  maxCellChars: 20_000,
} as const;

function resolveDelimiter(choice: LegacyCsvDelimiterChoice, input: string): LegacyCsvDelimiter {
  if (choice === "COMMA") return ",";
  if (choice === "SEMICOLON") return ";";
  if (choice === "TAB") return "\t";

  const candidates: LegacyCsvDelimiter[] = [";", ",", "\t"];
  const counts = candidates.map((delimiter) => ({ delimiter, columns: firstRecordColumns(input, delimiter) }));
  const largest = Math.max(...counts.map((item) => item.columns));
  if (largest <= 1) return ";"; // Greek spreadsheet exports commonly use semicolons.
  return counts.find((item) => item.columns === largest)!.delimiter;
}

/** Count separators outside quotes on the first logical record. */
function firstRecordColumns(input: string, delimiter: LegacyCsvDelimiter): number {
  let columns = 1;
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (ch === '"') {
      if (quoted && input[i + 1] === '"') {
        i++;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && ch === delimiter) columns++;
    if (!quoted && (ch === "\n" || ch === "\r")) break;
  }
  return columns;
}

function headerKey(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("el-GR");
}

export function parseLegacyCsv(input: string, options: LegacyCsvOptions = {}): ParsedLegacyCsv {
  const maxBytes = options.maxBytes ?? DEFAULTS.maxBytes;
  const maxRows = options.maxRows ?? DEFAULTS.maxRows;
  const maxColumns = options.maxColumns ?? DEFAULTS.maxColumns;
  const maxCellChars = options.maxCellChars ?? DEFAULTS.maxCellChars;

  if (!input || input.trim().length === 0) throw new LegacyCsvError("EMPTY_FILE", "Το αρχείο CSV είναι κενό.");
  if (Buffer.byteLength(input, "utf8") > maxBytes) throw new LegacyCsvError("FILE_TOO_LARGE", "Το αρχείο CSV ξεπερνά το επιτρεπόμενο μέγεθος.");
  if (input.includes("\0")) throw new LegacyCsvError("NULL_BYTE", "Το αρχείο CSV περιέχει μη επιτρεπτούς χαρακτήρες.");

  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const requested = options.delimiter ?? "AUTO";
  const delimiter = resolveDelimiter(requested, text);

  const records: Array<{ rowNumber: number; values: string[] }> = [];
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;
  let logicalRow = 1;

  const append = (ch: string) => {
    field += ch;
    if (field.length > maxCellChars) {
      throw new LegacyCsvError("FIELD_TOO_LONG", "Ένα κελί του CSV ξεπερνά το επιτρεπόμενο μήκος.");
    }
  };

  const finishField = () => {
    fields.push(field);
    field = "";
    if (fields.length > maxColumns) {
      throw new LegacyCsvError("TOO_MANY_COLUMNS", "Το CSV περιέχει περισσότερες στήλες από το επιτρεπόμενο όριο.");
    }
  };

  const finishRecord = () => {
    finishField();
    const blank = fields.length === 1 && fields[0]!.trim() === "";
    if (!blank) {
      records.push({ rowNumber: logicalRow, values: fields });
      if (records.length > maxRows + 1) {
        throw new LegacyCsvError("TOO_MANY_ROWS", "Το CSV περιέχει περισσότερες εγγραφές από το επιτρεπόμενο όριο.");
      }
    }
    fields = [];
    logicalRow++;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          append('"');
          i++;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else if (ch === "\r") {
        append("\n");
        if (text[i + 1] === "\n") i++;
      } else {
        append(ch);
      }
      continue;
    }

    if (afterQuote) {
      if (ch === delimiter) {
        finishField();
        afterQuote = false;
      } else if (ch === "\n" || ch === "\r") {
        finishRecord();
        afterQuote = false;
        if (ch === "\r" && text[i + 1] === "\n") i++;
      } else {
        throw new LegacyCsvError("INVALID_QUOTE", "Το CSV περιέχει μη έγκυρη χρήση εισαγωγικών.");
      }
      continue;
    }

    if (ch === '"') {
      if (field.length !== 0) throw new LegacyCsvError("INVALID_QUOTE", "Το CSV περιέχει μη έγκυρη χρήση εισαγωγικών.");
      quoted = true;
    } else if (ch === delimiter) {
      finishField();
    } else if (ch === "\n" || ch === "\r") {
      finishRecord();
      if (ch === "\r" && text[i + 1] === "\n") i++;
    } else {
      append(ch);
    }
  }

  if (quoted) throw new LegacyCsvError("UNTERMINATED_QUOTE", "Το CSV περιέχει πεδίο χωρίς κλείσιμο εισαγωγικών.");
  if (field.length > 0 || fields.length > 0 || afterQuote) finishRecord();

  const header = records.shift();
  if (!header) throw new LegacyCsvError("EMPTY_FILE", "Το αρχείο CSV δεν περιέχει επικεφαλίδες.");

  const headers = header.values.map((value) => value.trim());
  const seen = new Set<string>();
  for (const value of headers) {
    const key = headerKey(value);
    if (!key) throw new LegacyCsvError("EMPTY_HEADER", "Το CSV περιέχει κενή επικεφαλίδα στήλης.");
    if (seen.has(key)) throw new LegacyCsvError("DUPLICATE_HEADER", "Το CSV περιέχει διπλές επικεφαλίδες στηλών.");
    seen.add(key);
  }

  if (records.length === 0) throw new LegacyCsvError("NO_DATA_ROWS", "Το CSV δεν περιέχει εγγραφές.");

  const rows = records.map(({ rowNumber, values }) => ({
    rowNumber,
    values,
    issues: values.length === headers.length
      ? []
      : [{ code: "COLUMN_COUNT_MISMATCH" as const, expectedColumns: headers.length, actualColumns: values.length }],
  }));

  return { headers, delimiter, rows };
}
