import { Icon } from "./Icon";
import { Logo } from "./Logo";

/**
 * Shared frame for every signed-out page (login, password reset, invitation):
 * a HOME88 brand panel beside the form, collapsing to the form alone on
 * phones. Server component: no client JavaScript for the frame itself.
 */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const year = new Date().getFullYear();
  return (
    <div className="auth">
      <section className="auth__brand" aria-label="HOME88 CRM">
        <Logo variant="white" width={170} className="auth__logo" />
        <div className="auth__pitch">
          <p className="auth__eyebrow">HOME88 CRM</p>
          <h2 className="auth__title">Όλο το γραφείο σας, σε ένα σημείο.</h2>
          <p className="auth__lead">
            Ακίνητα, πελάτες και εκδηλώσεις ενδιαφέροντος, συνδεδεμένα με τον ιστότοπο και τα portals.
          </p>
          <ul className="auth__points">
            <li>
              <Icon name="building" />
              Χαρτοφυλάκιο ακινήτων και δημοσιεύσεις
            </li>
            <li>
              <Icon name="inbox" />
              Leads από τον ιστότοπο και τα portals
            </li>
            <li>
              <Icon name="chart" />
              Η δραστηριότητα του γραφείου με μια ματιά
            </li>
          </ul>
        </div>
        <p className="auth__legal">© {year} HOME88 · Πρόσβαση μόνο για εξουσιοδοτημένους συνεργάτες</p>
      </section>

      <main className="auth__panel">
        <div className="auth__card">
          <div className="auth__mobile-logo">
            <Logo width={150} />
          </div>
          <h1>{title}</h1>
          {subtitle && <p className="auth__sub">{subtitle}</p>}
          {children}
          {footer}
          <p className="auth__note">
            <Icon name="lock" size={14} />
            <span>
              Ασφαλής σύνδεση. Ο κωδικός σας δεν αποθηκεύεται ποτέ σε απλή μορφή και η συνεδρία λήγει
              αυτόματα.
            </span>
          </p>
        </div>
      </main>
    </div>
  );
}
