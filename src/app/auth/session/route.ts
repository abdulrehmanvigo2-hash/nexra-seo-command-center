import { NextResponse } from "next/server";
import { getOperator } from "@/lib/auth/session";

/**
 * Who is signed in, for the account menu.
 *
 * The pages are rendered once for every operator, so they cannot carry the
 * signed-in email; the header asks here instead. Checked against the Auth
 * server on every call, never cached.
 */
export async function GET() {
  const operator = await getOperator();
  const headers = { "Cache-Control": "private, no-store" };

  if (!operator) {
    return NextResponse.json({ signedIn: false }, { status: 401, headers });
  }
  return NextResponse.json({ signedIn: true, email: operator.email }, { headers });
}
