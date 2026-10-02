import { USER_ROLE_LABELS, label } from "@home88/types";

import { revokeInvitationAction } from "@/actions/invitations";
import { InviteForm } from "@/components/InviteForm";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { requireRole } from "@/lib/session";
import { assignableRoles } from "@/lib/user";

type InvitationRow = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  expiresAt: string;
  createdAt: string;
  invitedBy: string;
};

export default async function InvitationsPage() {
  const user = await requireRole("ADMIN");
  const result = await apiFetch<{ data: InvitationRow[] }>("/api/invitations", {
    query: { status: "pending" },
  });

  return (
    <>
      <h1 style={{ marginTop: 0 }}>Invitations</h1>
      <p className="muted">
        Στείλτε πρόσκληση σε συνεργάτη. Ο λογαριασμός δημιουργείται μόλις ορίσει ο ίδιος τον κωδικό του.
      </p>

      <div className="panel">
        <h2>Πρόσκληση χρήστη</h2>
        <InviteForm assignableRoles={assignableRoles(user.role)} />
      </div>

      <div className="panel">
        <h2>Εκκρεμείς προσκλήσεις</h2>
        {!result.ok ? (
          <div className="notice notice--danger">{result.error.message}</div>
        ) : result.data.data.length === 0 ? (
          <div className="empty">Δεν υπάρχουν εκκρεμείς προσκλήσεις.</div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Invited by</th>
                  <th>Expires</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {result.data.data.map((row) => (
                  <tr key={row.id}>
                    <td>
                      {row.firstName} {row.lastName}
                    </td>
                    <td>{row.email}</td>
                    <td>{label(USER_ROLE_LABELS, row.role, "el")}</td>
                    <td>{row.invitedBy}</td>
                    <td>{formatDateTime(row.expiresAt)}</td>
                    <td>
                      <form action={revokeInvitationAction}>
                        <input type="hidden" name="id" value={row.id} />
                        <button type="submit" className="btn btn--outline btn--sm">
                          Ανάκληση
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
