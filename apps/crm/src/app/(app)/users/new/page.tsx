import Link from "next/link";

import { saveUser } from "@/actions/users";
import { UserForm } from "@/components/UserForm";
import { requireRole } from "@/lib/session";
import { assignableRoles } from "@/lib/user";

export default async function NewUserPage() {
  const actor = await requireRole("ADMIN");

  return (
    <>
      <div className="between" style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0 }}>New user</h1>
        <Link href="/users" className="btn btn--outline btn--sm">
          Back to list
        </Link>
      </div>

      <UserForm
        action={saveUser}
        assignableRoles={assignableRoles(actor.role)}
        canEditRole
        canEditStatus={false}
        submitLabel="Create user"
      />
    </>
  );
}
