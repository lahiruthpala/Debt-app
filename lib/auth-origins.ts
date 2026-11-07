/** Exact trusted browser origins for Better Auth's CSRF checks. */
export const PRODUCTION_ORIGIN = "https://debt-app-ivory.vercel.app"

/** Trust the public production domain, configured app URL, and this deployment only. */
export function getTrustedAuthOrigins(baseURL?: string, vercelHost?: string): string[] {
  const values = [
    PRODUCTION_ORIGIN,
    baseURL,
    vercelHost ? `https://${vercelHost}` : undefined,
  ].filter((value): value is string => Boolean(value))
  return Array.from(new Set(values.map(value => new URL(value).origin)))
}
