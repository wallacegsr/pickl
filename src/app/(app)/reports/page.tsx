import { db } from "@/db";
import { users } from "@/db/schema";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import ReportsView from "@/components/ReportsView";

export const metadata = { title: "Past Preserves · Pickl" };

export default async function ReportsPage() {
  const session = await auth();
  const admin = isAdmin(session?.user);

  const householdUsers = admin
    ? db.select({ id: users.id, name: users.name }).from(users).all()
    : [];

  return (
    <div>
      <h2 className="mb-1">Past Preserves</h2>
      <p className="text-muted mb-4">
        Everything that has been planned, and every change made to it.
      </p>
      <ReportsView isAdmin={admin} householdUsers={householdUsers} />
    </div>
  );
}
