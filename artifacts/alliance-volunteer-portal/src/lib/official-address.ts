/** Only the published Replit alias forwards visitors; health checks stay server-side. */
export function officialAddressRedirect(current: { hostname: string; origin: string; pathname: string; search: string; hash: string },
  appOrigin: string, production: boolean): string | null {
  if (!production || !current.hostname.endsWith('.replit.app')) return null;
  try {
    const target = new URL(appOrigin);
    if (target.protocol !== 'https:' || target.username || target.password ||
      target.pathname !== '/' || target.search || target.hash || target.origin === current.origin) return null;
    return target.origin + current.pathname + current.search + current.hash;
  } catch { return null; }
}
