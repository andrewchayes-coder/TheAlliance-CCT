export function signoutTarget(appOrigin: string | null | undefined, baseUrl: string): string {
  return `${(appOrigin || baseUrl).replace(/\/$/, '')}/signin`;
}

/** A failed request must not leave an old-address tab displaying cached private pages. */
export async function signoutAndRedirect({
  request, clear, replace, appOrigin, baseUrl,
}: {
  request: () => Promise<unknown>;
  clear: () => void;
  replace: (target: string) => void;
  appOrigin?: string | null;
  baseUrl: string;
}): Promise<void> {
  const target = signoutTarget(appOrigin, baseUrl);
  try { await request(); } catch { /* Continue to the official sign-in page without an alarming error. */ }
  finally {
    clear();
    replace(target);
  }
}
