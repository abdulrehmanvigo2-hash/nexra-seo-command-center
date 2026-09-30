/**
 * Security headers sent on every response (fix F5, audit A1-01), applied by
 * `next.config.ts` through `headers()`.
 *
 * The Content-Security-Policy is Next.js's documented policy without nonces
 * (`node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`).
 * A nonce policy would make every page render dynamically; this one keeps
 * static rendering. `script-src` and `style-src` therefore allow
 * 'unsafe-inline' (the App Router's own inline bootstrap scripts and styles);
 * `'unsafe-eval'` is added in development only (React's dev tooling needs it).
 * Every other source is this origin: the pages load no external script, style,
 * font or image, and the browser talks only to this application's own routes
 * (Supabase is reached from the server, never from the page), so
 * `connect-src 'self'`. `upgrade-insecure-requests` is left out: every source
 * is already 'self' over the page's own scheme, HSTS covers production, and on
 * a local `next start` over http it would send the page's own requests to
 * https and break it.
 *
 * `frame-ancestors 'none'` and `X-Frame-Options: DENY` both refuse framing
 * (the second for browsers without CSP level 2). HSTS is ignored by browsers
 * over plain http, so it is harmless locally; Vercel's edge adds the same on
 * production.
 *
 * Pure.
 */

export type SecurityHeader = { readonly key: string; readonly value: string };

export function contentSecurityPolicy(isDevelopment: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function securityHeaders(isDevelopment: boolean): readonly SecurityHeader[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(isDevelopment) },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  ];
}
