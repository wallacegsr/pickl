import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { auth } from "@/lib/auth";
import { householdScope, isAdmin } from "@/lib/permissions";
import ReportsView from "@/components/ReportsView";
import { listVisibleTags } from "@/lib/tags";

export const metadata = { title: "Past Preserves · Pickl" };

export default async function ReportsPage() {
  const session = await auth();
  const admin = isAdmin(session?.user);

  const householdId = householdScope(session?.user);
  const householdUsers =
    admin && householdId
      ? db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(eq(users.householdId, householdId))
          .all()
      : [];

  // Same visibility rule as the Tags page: a tag living only on someone
  // else's private recipe is not offered as a filter.
  const allTags = session?.user
    ? listVisibleTags(session.user).map((t) => t.name)
    : [];

  return (
    <div>
      <h2 className="mb-1">Past Preserves</h2>
      <p className="text-muted mb-4">
        Everything that has been planned, and every change made to it.
      </p>
      <ReportsView isAdmin={admin} householdUsers={householdUsers} allTags={allTags} />
    </div>
  );
}
