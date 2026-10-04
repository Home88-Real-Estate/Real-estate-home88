import { MANDATE_MERGE_FIELDS } from "@home88/domain";

/**
 * The data fields an approved text may contain. They are filled in when a
 * mandate is issued; any other {{…}} is refused when the text is saved.
 */
export function MergeFields() {
  return (
    <details className="subpanel">
      <summary>Πεδία που συμπληρώνονται αυτόματα</summary>
      <p className="muted" style={{ marginTop: 0 }}>
        Γράψτε το πεδίο μέσα σε διπλές αγκύλες όπου πρέπει να μπει η τιμή, π.χ. <span className="mono">{"{{principal.fullName}}"}</span>. Αν κάποια τιμή λείπει, η εντολή δεν εκδίδεται μέχρι να συμπληρωθεί.
      </p>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Πεδίο</th><th>Τι συμπληρώνεται</th></tr></thead>
          <tbody>
            {MANDATE_MERGE_FIELDS.map((f) => (
              <tr key={f.key}><td className="mono">{`{{${f.key}}}`}</td><td>{f.label}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
