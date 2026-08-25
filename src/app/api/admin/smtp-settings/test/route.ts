import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { smtpTestEmailSchema } from "@/lib/validators";
import { sendTestEmail } from "@/lib/mail";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || !isAdmin(session.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = smtpTestEmailSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid input" },
      { status: 400 }
    );
  }

  try {
    await sendTestEmail(parsed.data.to);
    return NextResponse.json({
      message: `Test email sent to ${parsed.data.to}.`,
    });
  } catch (err) {
    // Surface the real SMTP error (auth failure, connection refused,
    // etc.) rather than a generic message — that's the whole point of
    // this feature.
    const message =
      err instanceof Error ? err.message : "Failed to send test email.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
