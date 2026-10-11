import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Me } from '@workspace/api-client-react';
import { useAuth } from '@/auth/auth-context';

export type AccountProfile = {
  user: Me['user'];
  photoUrl: string | null;
  pendingEmail: string | null;
  pendingEmailExpiresAt: string | null;
  message?: string;
  deliveryFailed?: boolean;
};
export type AccountDetails = { firstName: string; lastName: string; phone: string | null };
export type EmailChange = { email: string; currentPassword?: string };
const base = import.meta.env.BASE_URL.replace(/\/$/, '');
export const accountPhotoUrl = (url: string) => `${base}${url}`;

/** Identity-qualified keys prevent personal data being reused after account switches. */
export function useAccountProfile(userId: string, managed = false) {
  const auth = useAuth();
  const qc = useQueryClient();
  const path = managed ? `/api/admin/users/${userId}` : '/api/account';
  const key = [path + '/profile', userId];
  async function call<T>(suffix: string, method = 'GET', body?: unknown): Promise<T> {
    const multipart = body instanceof FormData;
    const headers = new Headers(auth.request.headers);
    if (body !== undefined && !multipart) headers.set('Content-Type', 'application/json');
    const response = await fetch(`${base}${path}${suffix}`, {
      ...auth.request, method, headers, cache: 'no-store',
      ...(body !== undefined ? { body: multipart ? body : JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error ?? 'Please try again.'), { status: response.status, data });
    return data as T;
  }
  const query = useQuery({ queryKey: key, queryFn: () => call<AccountProfile>('/profile'), staleTime: 0, enabled: !!userId });
  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: key }),
      qc.invalidateQueries({ predicate: q => typeof q.queryKey[0] === 'string' &&
        (q.queryKey[0] === '/api/me' || q.queryKey[0] === '/api/auth/session' || q.queryKey[0].startsWith('/api/admin/') || q.queryKey[0].startsWith('/api/volunteer/')) }),
    ]);
  };
  const save = useMutation({ mutationFn: (data: AccountDetails) => call<AccountProfile>('/profile', 'PATCH', data), onSuccess: refresh });
  const email = useMutation({ mutationFn: (data: EmailChange) => call<AccountProfile>('/email', 'POST', data), onSuccess: refresh });
  const cancelEmail = useMutation({ mutationFn: () => call<AccountProfile>('/email', 'DELETE'), onSuccess: refresh });
  const upload = useMutation({ mutationFn: (file: File) => {
    const data = new FormData(); data.append('file', file);
    return call<AccountProfile>('/photo', 'POST', data);
  }, onSuccess: refresh });
  const removePhoto = useMutation({ mutationFn: () => call<AccountProfile>('/photo', 'DELETE'), onSuccess: refresh });
  const resetPassword = useMutation({ mutationFn: () => call<{ ok: boolean; message: string; deliveryFailed?: boolean }>('/password-reset', 'POST', {}), onSuccess: refresh });
  return { ...query, save, email, cancelEmail, upload, removePhoto, resetPassword };
}
