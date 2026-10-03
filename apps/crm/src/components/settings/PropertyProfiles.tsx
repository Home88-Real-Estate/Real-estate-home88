import { applicableDetailKeys, fieldLabel, LISTING_PROFILES, PROPERTY_PROFILES } from "@home88/domain";
import { LISTING_TYPE_LABELS, PROPERTY_TYPE_LABELS, label } from "@home88/types";

/** Read-only view of the per-type field sets the property form uses today. */
export function PropertyProfiles() {
  const types = Object.keys(PROPERTY_PROFILES);
  const listings = Object.keys(LISTING_PROFILES);
  return (
    <div className="panel">
      <div className="panel__head">
        <div>
          <h2>Πεδία ανά τύπο ακινήτου</h2>
          <p className="panel__sub">
            Κάθε τύπος έχει τα δικά του πεδία, ανάλογα και με το είδος συναλλαγής. Η επεξεργασία τους από εδώ (ποια είναι
            υποχρεωτικά, ποια κρύβονται) έρχεται στη Φάση 4.
          </p>
        </div>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Τύπος</th>
              {listings.map((l) => <th key={l} scope="col" className="num">{label(LISTING_TYPE_LABELS, l, "el")}</th>)}
              <th scope="col">Ενδεικτικά πεδία</th>
            </tr>
          </thead>
          <tbody>
            {types.map((t) => {
              const keys = applicableDetailKeys(t, "SALE");
              return (
                <tr key={t}>
                  <th scope="row">{label(PROPERTY_TYPE_LABELS, t, "el")}</th>
                  {listings.map((l) => <td key={l} className="num">{applicableDetailKeys(t, l).length}</td>)}
                  <td className="muted">{keys.slice(0, 5).map((k) => fieldLabel(t, k)).join(", ")}{keys.length > 5 ? "…" : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
