import type { Metadata } from "next";
import { LoginForm } from "@/app/login/login-form";
import { Logo } from "@/components/icons";
import { safeNextPath } from "@/lib/auth/access";
import { AuthConfigurationError, readAuthConfig } from "@/lib/auth/config";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

function signInConfigured(): boolean {
  try {
    readAuthConfig(process.env);
    return true;
  } catch (error) {
    if (!(error instanceof AuthConfigurationError)) throw error;
    // The detail names environment variables: server log only.
    console.error("login:", error.message);
    return false;
  }
}

/**
 * The one page outside the application shell. Operators sign in here; there
 * is no sign-up and no password reset, because accounts are managed in
 * Supabase by whoever runs this deployment.
 */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  const configured = signInConfigured();

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-[360px]">
        <div className="mb-6 flex items-center gap-2.5">
          <Logo className="h-9 w-9 shrink-0" />
          <div className="min-w-0">
            <div className="text-[14px] leading-tight font-semibold tracking-tight text-fg">
              Nexra
            </div>
            <div className="text-[10.5px] leading-tight tracking-wide text-fg-subtle uppercase">
              SEO Command Center
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface p-5">
          <h1 className="text-[15px] font-semibold tracking-tight text-fg">Sign in</h1>
          <p className="mt-1 text-[12px] leading-snug text-fg-subtle">
            Nexra is private. Use the operator account you were given.
          </p>

          <div className="mt-5">
            {configured ? (
              <LoginForm next={safeNextPath(Array.isArray(next) ? next[0] : next)} />
            ) : (
              <p
                role="status"
                className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[12px] leading-snug text-fg-muted"
              >
                Sign-in is not configured on this server, so the application is closed. The
                server log names the missing setting.
              </p>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
