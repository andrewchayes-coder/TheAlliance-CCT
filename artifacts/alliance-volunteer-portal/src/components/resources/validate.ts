export const MAX_FILE = 15 * 1024 ** 2;
export const AGREEMENT_TITLES = ['user agreement', 'safety guidelines'];
export const isAgreementCat = (c: string) => c.trim().toLowerCase() === 'agreements';

export function fileError(f: File): string | null {
  const okType = /\.(pdf|docx)$/i.test(f.name) && (!f.type || f.type === 'application/pdf' || f.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  if (!okType) return 'Choose a PDF or DOCX file.';
  if (f.size > MAX_FILE) return 'That file is larger than 15 MB.';
  if (f.size === 0) return 'That file is empty.';
  return null;
}

export function httpsError(u: string): string | null {
  try {
    const url = new URL(u.trim());
    if (url.protocol !== 'https:') return 'Links must start with https://';
    if (url.username || url.password) return 'Links cannot contain a username or password.';
    return null;
  } catch { return 'Enter a full link, like https://example.org'; }
}
