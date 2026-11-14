/**
 * Server components and API routes pass getPublicBaseUrl() to client components
 * as a prop; client code calls toPublicUrl(path, base) to fall back to the
 * browser address when no public base URL was configured.
 */

/** Validate and normalize the configured public HTTP(S) base URL. */
export function getPublicBaseUrl(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const configured = env.PUBLIC_BASE_URL?.trim();
  if (!configured) return null;

  try {
    const parsed = new URL(configured);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return configured.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/** Join a route path to a configured base URL or the current browser origin. */
export function toPublicUrl(path: string, baseUrl?: string | null): string {
  const base =
    baseUrl ?? (typeof window !== "undefined" ? window.location.origin : "");
  const normalizedPath = `/${path.replace(/^\/+/, "")}`;
  return base ? `${base.replace(/\/+$/, "")}${normalizedPath}` : normalizedPath;
}
