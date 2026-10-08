import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getAuthSession, getGetAuthSessionQueryKey, getGetMeQueryKey, getListTeamUsersQueryKey, useAcceptAdminInvite, useInviteAdmin, useSetUserActiveStatus, useForgotPassword, useGetAuthSession,
  useResendVerification, useResetPassword, useSignin, useSignout, useSignup, useVerifyEmail,
  type AuthSession,
} from '@workspace/api-client-react';

export const FETCH_CREDS = { credentials: 'same-origin' as const };
export const FRESH_MS = 15_000;

export type ApiFailure = { message: string; code?: string; nextPath?: string; retryAfterSeconds?: number; status?: number };

export function readError(e: unknown, fallback = 'Something went wrong on our end. Please try again — if it keeps happening, let The Alliance know.'): ApiFailure {
  const err = e as { status?: number; data?: unknown } | null;
  const d = (err && typeof err === 'object' ? err.data : null) as Record<string, unknown> | null;
  const message = d && typeof d.error === 'string' && d.error ? d.error : fallback;
  return {
    message,
    status: err?.status,
    code: typeof d?.code === 'string' ? d.code : undefined,
    nextPath: typeof d?.nextPath === 'string' ? d.nextPath : undefined,
    retryAfterSeconds: typeof d?.retryAfterSeconds === 'number' ? d.retryAfterSeconds : undefined,
  };
}

function useAuthValue() {
  const qc = useQueryClient();
  const csrfRef = useRef('');
  const [flash, setFlash] = useState<string | null>(null);
  const q = useGetAuthSession({
    query: { queryKey: getGetAuthSessionQueryKey(), staleTime: FRESH_MS, refetchOnWindowFocus: 'always', retry: false },
    request: FETCH_CREDS,
  });
  if (q.data) csrfRef.current = q.data.csrfToken;

  // Headers are read when each request fires, so a refreshed token is always used.
  const request = useMemo(() => ({
    ...FETCH_CREDS,
    headers: { get 'X-CSRF-Token'() { return csrfRef.current; } } as unknown as HeadersInit,
  }), []);

  const refresh = useCallback(async (): Promise<AuthSession> => {
    qc.removeQueries({ queryKey: getGetMeQueryKey() });
    qc.removeQueries({ queryKey: getListTeamUsersQueryKey().slice(0, 1) });
    qc.removeQueries({ predicate: query => typeof query.queryKey[0] === 'string' &&
      (query.queryKey[0].startsWith('/api/admin/') || query.queryKey[0].startsWith('/api/volunteer/')) });
    const s = await qc.fetchQuery({ queryKey: getGetAuthSessionQueryKey(), queryFn: () => getAuthSession(FETCH_CREDS), staleTime: 0 });
    csrfRef.current = s.csrfToken;
    return s;
  }, [qc]);

  const signupM = useSignup({ request });
  const signinM = useSignin({ request });
  const verifyM = useVerifyEmail({ request });
  const forgotM = useForgotPassword({ request });
  const resetM = useResetPassword({ request });
  const resendM = useResendVerification({ request });
  const acceptM = useAcceptAdminInvite({ request });
  const inviteM = useInviteAdmin({ request });
  const statusM = useSetUserActiveStatus({ request });
  const signoutM = useSignout({ request });

  const actions = {
    signup: async (data: Parameters<typeof signupM.mutateAsync>[0]['data']) => {
      const r = await signupM.mutateAsync({ data }); await refresh(); return r;
    },
    signin: async (data: Parameters<typeof signinM.mutateAsync>[0]['data']) => {
      const r = await signinM.mutateAsync({ data }); await refresh(); return r;
    },
    verify: async (token: string) => {
      const r = await verifyM.mutateAsync({ data: { token } }); await refresh(); return r;
    },
    forgot: (email: string) => forgotM.mutateAsync({ data: { email } }),
    reset: async (data: Parameters<typeof resetM.mutateAsync>[0]['data']) => {
      const r = await resetM.mutateAsync({ data }); await refresh(); return r;
    },
    acceptInvite: async (data: Parameters<typeof acceptM.mutateAsync>[0]['data']) => {
      const r = await acceptM.mutateAsync({ data }); await refresh(); return r;
    },
    inviteAdmin: async (data: Parameters<typeof inviteM.mutateAsync>[0]['data']) => {
      const r = await inviteM.mutateAsync({ data });
      await qc.invalidateQueries({ queryKey: getListTeamUsersQueryKey().slice(0, 1) });
      return r;
    },
    setActive: async (userId: string, isActive: boolean) => {
      const r = await statusM.mutateAsync({ userId, data: { isActive } });
      await qc.invalidateQueries({ queryKey: getListTeamUsersQueryKey().slice(0, 1) });
      return r;
    },
    resend: () => resendM.mutateAsync(undefined),
    signout: async () => {
      try { await signoutM.mutateAsync(undefined); } finally {
        qc.removeQueries({ queryKey: getGetMeQueryKey() });
        qc.removeQueries({ queryKey: getListTeamUsersQueryKey().slice(0, 1) });
        await refresh();
      }
    },
  };

  return {
    session: q.data, sessionLoading: q.isPending, sessionError: q.isError, retrySession: () => { void q.refetch(); },
    refresh, request, flash, setFlash, ...actions,
  };
}

type AuthValue = ReturnType<typeof useAuthValue>;
const Ctx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const v = useAuthValue();
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}
