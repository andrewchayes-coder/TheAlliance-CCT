import { isProfileComplete } from '@/lib/profile-complete';
import { appConfig } from '@workspace/shared/appConfig';
import { useEffect, useRef, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import { useGetMe, getGetMeQueryKey, type Me } from '@workspace/api-client-react';
import { PublicLayout, Button } from '@/components/brand-system';
import { AuthHeading, AuthLoading, SessionFailed } from './auth-ui';
import { FETCH_CREDS, FRESH_MS, useAuth } from './auth-context';

/** Renders children only after session says verified AND /api/me succeeded. */
function Redirect({ to }: { to: string }) {
  const [, nav] = useLocation();
  useEffect(() => { nav(to, { replace: true }); }, [to, nav]);
  return <AuthLoading label="Taking you to the right place" />;
}

/** Admins are sent to /admin from volunteer pages; with area="admin", volunteers are sent to /dashboard. */
export function RequireVerified({ children, area = 'volunteer', allowIncomplete = false }: { children: (me: Me) => ReactNode; area?: 'volunteer' | 'admin'; allowIncomplete?: boolean }) {
  const { session, sessionLoading, sessionError, refresh, signout } = useAuth();
  const [path, nav] = useLocation();
  const ok = !!session?.authenticated && session.verified;
  const me = useGetMe({
    query: { queryKey: getGetMeQueryKey(), enabled: ok, staleTime: FRESH_MS, refetchOnWindowFocus: 'always', retry: false },
    request: FETCH_CREDS,
  });
  const retried = useRef(false);
  const status = (me.error as { status?: number } | null)?.status;

  useEffect(() => {
    if (!session) return;
    if (!session.authenticated) nav('/signin', { replace: true });
    else if (!session.verified) nav('/verify-email', { replace: true });
  }, [session, nav]);

  useEffect(() => {
    if ((status === 401 || status === 403) && !retried.current) {
      retried.current = true;
      void refresh().catch(() => undefined);
    }
  }, [status, refresh]);

  if (sessionLoading) return <AuthLoading label="Checking your account" />;
  if (!session) return sessionError ? <SessionFailed /> : <AuthLoading />;
  if (!ok) return <AuthLoading label="Taking you to sign in" />;
  // Never render an older privileged /me cache once bootstrap knows the actor's role changed.
  if (area === 'admin' && session.role !== 'admin') return <Redirect to="/dashboard" />;
  if (area === 'volunteer' && session.role === 'admin') return <Redirect to="/admin" />;
  if (me.data && me.data.verified) {
    if (area === 'admin' && me.data.role !== 'admin') return <Redirect to="/dashboard" />;
    if (area === 'volunteer' && me.data.role === 'admin') return <Redirect to="/admin" />;
    if (area === 'volunteer' && !allowIncomplete && !isProfileComplete(me.data)) return <Redirect to="/onboarding" />;
    if (area === 'volunteer' && appConfig.requireAgreementAcknowledgment && me.data.agreementRequired && (path === '/shifts' || path.startsWith('/shifts/'))) return <Redirect to="/agreements" />;
    return <>{children(me.data)}</>;
  }
  if (me.isError && (status === 401 || status === 403) && retried.current && !me.isFetching && ok) {
    return (
      <PublicLayout>
        <AuthHeading label="Account check" title="We couldn't confirm your account">
          Please sign in again to continue.
        </AuthHeading>
        <Button onClick={() => { void signout().then(() => nav('/signin')).catch(() => nav('/signin')); }}>Sign in again</Button>
      </PublicLayout>
    );
  }
  if (me.isError && status !== 401 && status !== 403) {
    return (
      <PublicLayout>
        <AuthHeading label="Connection problem" title="Your account didn't load">
          Something interrupted the request. Your information is safe.
        </AuthHeading>
        <Button onClick={() => { void me.refetch(); }}>Try again</Button>
      </PublicLayout>
    );
  }
  return <AuthLoading label="Loading your account" />;
}

export const RequireAdmin = ({ children }: { children: (me: Me) => ReactNode }) => <RequireVerified area="admin">{children}</RequireVerified>;
