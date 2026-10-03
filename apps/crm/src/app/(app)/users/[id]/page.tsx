import Link from "next/link";
import { notFound } from "next/navigation";
import { USER_ROLE_LABELS, USER_STATUS_LABELS, label } from "@home88/types";

import { saveUser } from "@/actions/users";
import { StatusBadge } from "@/components/StatusBadge";
import { UserAdminPanel } from "@/components/UserAdminPanel";
import { UserForm } from "@/components/UserForm";
import { apiFetch } from "@/lib/api";
import { formatDateTime, personName } from "@/lib/format";
import { hasRole, requireRole } from "@/lib/session";
import { assignableRoles, outranks } from "@/lib/user";

type UserDetail = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  role: string;
  status: string;
  locale: string;
  avatarUrl: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireRole("MANAGER");
  const { id } = await params;

  const result = await apiFetch<{ user: UserDetail }>(`/api/users/${id}`);
  if (!result.ok) {
    if (result.status === 404) notFound();
    return <div className="notice notice--danger">{result.error.message}</div>;
  }
  const target = result.data.user;

  const admin = hasRole(actor.role, "ADMIN");
  const isSelf = actor.id === target.id;
  const canManageTarget = admin && outranks(actor.role, target.role);
  const canEditBasics = canManageTarget || (isSelf && admin);

  return (
    <>
      <div className="between" style={{ marginBottom: 16 }}>
        <div>
          <div className="row" style={{ marginBottom: 4 }}>
            <StatusBadge value={target.status} kind="user" />
            <span className="badge badge--muted">{label(USER_ROLE_LABELS, target.role, "el")}</span>
            {isSelf && <span className="badge badge--muted">Εσείς</span>}
          </div>
          <h1 style={{ margin: 0 }}>{personName(target.firstName, target.lastName)}</h1>
        </div>
        <Link href="/users" className="btn btn--outline btn--sm">
          Επιστροφή στη λίστα
        </Link>
      </div>

      <div className="panel">
        <h2>Στοιχεία</h2>
        <dl className="dl">
          <dt>Email</dt>
          <dd>{target.email}</dd>
          <dt>Τηλέφωνο</dt>
          <dd>{target.phone ? <a href={`tel:${target.phone}`}>{target.phone}</a> : "-"}</dd>
          <dt>Ρόλος</dt>
          <dd>{label(USER_ROLE_LABELS, target.role, "el")}</dd>
          <dt>Κατάσταση</dt>
          <dd>{label(USER_STATUS_LABELS, target.status, "el")}</dd>
          <dt>Τελευταία σύνδεση</dt>
          <dd>{formatDateTime(target.lastLoginAt)}</dd>
          <dt>Δημιουργία</dt>
          <dd>{formatDateTime(target.createdAt)}</dd>
          <dt>Ενημέρωση</dt>
          <dd>{formatDateTime(target.updatedAt)}</dd>
        </dl>
      </div>

      {!canEditBasics && (
        <div className="notice">
          Δεν έχετε δικαίωμα να επεξεργαστείτε αυτόν τον λογαριασμό.
        </div>
      )}

      {canEditBasics && (
        <UserForm
          action={saveUser}
          initial={target}
          assignableRoles={assignableRoles(actor.role)}
          canEditRole={canManageTarget}
          canEditStatus={canManageTarget}
          submitLabel="Αποθήκευση αλλαγών"
        />
      )}

      {(canManageTarget || (isSelf && admin)) && (
        <UserAdminPanel
          id={target.id}
          status={target.status}
          canResetPassword
          canChangeStatus={canManageTarget}
        />
      )}
    </>
  );
}
