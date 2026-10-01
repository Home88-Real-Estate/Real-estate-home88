import Link from "next/link";

export default function NotFound() {
  return (
    <div className="wrap section" style={{ textAlign: "center", paddingBlock: 80 }}>
      <p className="pill">404</p>
      <h1>Η σελίδα δεν βρέθηκε</h1>
      <p className="muted">
        Ο σύνδεσμος μπορεί να έχει αλλάξει ή το ακίνητο να μην είναι πλέον διαθέσιμο.
      </p>
      <div className="row" style={{ justifyContent: "center", marginTop: 20 }}>
        <Link href="/properties" className="btn btn--primary">
          Δείτε τα ακίνητα
        </Link>
        <Link href="/" className="btn btn--outline">
          Αρχική
        </Link>
      </div>
    </div>
  );
}
