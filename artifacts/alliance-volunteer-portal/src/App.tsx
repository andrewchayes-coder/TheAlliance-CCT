import { lazy, Suspense, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import Home from '@/pages/home';
import Signup from '@/pages/signup';
import Signin from '@/pages/signin';
import { ForgotPassword, ResetPassword } from '@/pages/recovery';
import { VerifyEmailPage, VerifyTokenPage } from '@/pages/verify';
import { Dashboard } from '@/pages/volunteer-home';
import { Shifts, Messages, Resources } from '@/pages/volunteer-pages';
import { Profile } from '@/pages/volunteer-profile';
import { Onboarding, OnboardingAgreement } from '@/pages/onboarding';
import { AdminHome, AdminTeam, AdminVolunteerOnboarding, AcceptInvite } from '@/pages/admin';
import { AdminRoster, AdminVolunteerDetail } from '@/pages/admin-volunteers';
import { AdminSchedule } from '@/pages/admin-schedule';
import { AdminMessages } from '@/pages/admin-messages';
import { AdminScheduleSettings } from '@/pages/admin-schedule-settings';
import { AdminNotificationJobs } from '@/pages/admin-notification-jobs';
import { AdminNotifications } from '@/pages/admin-notifications';
import { AuthProvider } from '@/auth/auth-context';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: 'always', retry: false } } });
const StyleGuide = import.meta.env.DEV ? lazy(() => import('@/pages/style-guide')) : null;

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/signup" component={Signup} />
        <Route path="/signin" component={Signin} />
        <Route path="/verify-email" component={VerifyEmailPage} />
        <Route path="/verify" component={VerifyTokenPage} />
        <Route path="/forgot-password" component={ForgotPassword} />
        <Route path="/reset-password" component={ResetPassword} />
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/dashboard/:rest*" component={Dashboard} />
        <Route path="/shifts" component={Shifts} />
        <Route path="/shifts/:rest*" component={Shifts} />
        <Route path="/messages" component={Messages} />
        <Route path="/messages/:rest*" component={Messages} />
        <Route path="/resources" component={Resources} />
        <Route path="/resources/:rest*" component={Resources} />
        <Route path="/profile" component={Profile} />
        <Route path="/onboarding" component={Onboarding} />
        <Route path="/onboarding/agreements/:resourceId" component={OnboardingAgreement} />
        <Route path="/onboarding/:rest*" component={Onboarding} />
        <Route path="/accept-invite" component={AcceptInvite} />
        <Route path="/admin" component={AdminHome} />
        <Route path="/admin/team" component={AdminTeam} />
        <Route path="/admin/volunteers/:userId/onboarding" component={AdminVolunteerOnboarding} />
        <Route path="/admin/volunteers" component={AdminRoster} />
        <Route path="/admin/volunteers/:userId" component={AdminVolunteerDetail} />
        <Route path="/admin/messages" component={AdminMessages} />
        <Route path="/admin/schedule" component={AdminSchedule} />
        <Route path="/admin/schedule/settings" component={AdminScheduleSettings} />
        <Route path="/admin/notifications" component={AdminNotifications} />
        <Route path="/admin/notifications/jobs" component={AdminNotificationJobs} />
        <Route path="/admin/:rest*" component={AdminHome} />
        {import.meta.env.DEV && StyleGuide && (
          <Route path="/style-guide">
            <Suspense fallback={<p className="p-6">Loading the style guide…</p>}>
              <StyleGuide />
            </Suspense>
          </Route>
        )}
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <AuthProvider>
            <Router />
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
