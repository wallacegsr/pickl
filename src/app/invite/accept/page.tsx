import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import InviteAcceptForm from "@/components/InviteAcceptForm";

export default async function InviteAcceptPage({
  searchParams,
}: {
  searchParams: { token?: string };
}) {
  const token = searchParams.token ?? null;

  let error: string | null = null;
  let email: string | null = null;
  let name: string | null = null;

  if (!token) {
    error = "Missing invite token.";
  } else {
    const user = db.select().from(users).where(eq(users.inviteToken, token)).get();
    if (!user) {
      error = "That invite link is invalid.";
    } else if (
      user.inviteTokenExpires &&
      user.inviteTokenExpires.getTime() < Date.now()
    ) {
      error = "That invite link has expired. Ask an admin to invite you again.";
    } else {
      email = user.email;
      name = user.name;
    }
  }

  return (
    <InviteAcceptForm token={token} email={email} name={name} initialError={error} />
  );
}
