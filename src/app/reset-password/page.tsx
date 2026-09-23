import AuthCard from "@/components/auth/AuthCard";
import ResetPasswordForm from "@/components/auth/ResetPasswordForm";
import { findResetUser } from "@/lib/passwordReset";

export const metadata = { title: "Reset password · Pickl" };

/**
 * Where the emailed link lands. The link is checked here first, so an expired
 * or spent one says so before anyone types a new password into it.
 */
export default async function ResetPasswordPage(props: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await props.searchParams;
  const found = findResetUser(token);
  return (
    <AuthCard title="Reset password">
      <ResetPasswordForm
        token={token ?? null}
        email={found.ok ? found.user.email : null}
        initialError={found.ok ? null : found.error}
      />
    </AuthCard>
  );
}
