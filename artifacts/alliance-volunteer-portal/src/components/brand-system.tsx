import { useRef, useState, type ReactNode } from 'react';
import { Home, CalendarDays, UserRound, Menu, HeartHandshake, MessageSquare, BookOpen } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useAuth } from '@/auth/auth-context';
import { useGetMessageContext, getGetMessageContextQueryKey } from '@workspace/api-client-react';
import { FETCH_CREDS } from '@/auth/auth-context';
import { appConfig } from '@workspace/shared/appConfig';
import { TestAccountBanner } from '@/components/quick-login';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';

export { Button } from '@/components/ui/button';
export { Input } from '@/components/ui/input';
export { Card } from '@/components/ui/card';

export function StatusBadge({ status, children }: { status: 'neutral' | 'good' | 'attention' | 'blocked'; children: ReactNode }) {
  return <Badge variant={status} data-testid={`status-${status}`}>{children}</Badge>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-gray bg-white px-6 py-8 text-center" data-testid="empty-state">
      <HeartHandshake className="mx-auto mb-4 text-navy" size={28} aria-hidden="true" />
      <h3 className="alliance-display text-navy">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-navy">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

function BrandMark() {
  const base = import.meta.env.BASE_URL;
  return (
    <div className="min-w-0 shrink-0" data-testid="brand-mark">
      <img src={`${base}brand/logo-horizontal.png`} alt={`${appConfig.orgName} ${appConfig.programName}`} className="hidden h-10 w-auto md:block" />
      <img src={`${base}brand/logo-mark.png`} alt={`${appConfig.orgName} ${appConfig.programName}`} className="block h-9 w-auto md:hidden" />
    </div>
  );
}

export function PublicLayout({ children, contained = true, below }: { children: ReactNode; contained?: boolean; below?: ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-white text-navy" data-testid="public-layout">
      <TestAccountBanner />
      {contained ? (
        <main className="flex min-h-[100dvh] flex-col items-center justify-center px-4 py-10">
          <img src={`${import.meta.env.BASE_URL}brand/logo-stacked.png`} alt={`${appConfig.orgName} ${appConfig.programName}`} className="mb-8 h-auto w-full max-w-[240px]" data-testid="logo-stacked" />
          <Card className="w-full max-w-xl">{children}</Card>
          {below}
          <p className="mt-8 max-w-xl text-center text-[15px] leading-relaxed text-navy" data-testid="text-mission">{appConfig.missionLine}</p>
        </main>
      ) : (
        <>
          <header className="border-b-[3px] border-navy bg-white">
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3 md:px-8">
              <BrandMark />
              <span className="hidden text-sm font-semibold text-navy sm:block">{appConfig.defaultCounty} County</span>
            </div>
          </header>
          <main>{children}</main>
        </>
      )}
    </div>
  );
}

const volunteerNav = [
  { label: 'Home', href: '/dashboard', icon: Home },
  { label: 'My Shifts', href: '/shifts', icon: CalendarDays },
  { label: 'Messages', href: '/messages', icon: MessageSquare },
  { label: 'Resources', href: '/resources', icon: BookOpen },
  { label: 'Profile', href: '/profile', icon: UserRound },
];
const adminNav = ['Overview', 'Volunteers', 'Master schedule', 'Messages', 'Resources'];
const adminItems: { label: string; href?: string }[] = [
  { label: 'Overview', href: '/admin' }, { label: 'Volunteers', href: '/admin/volunteers' }, { label: 'Team', href: '/admin/team' }, { label: 'My Profile', href: '/profile' },
  { label: 'Master schedule', href: '/admin/schedule' }, { label: 'Schedule settings', href: '/admin/schedule/settings' }, { label: 'Messages', href: '/admin/messages' }, { label: 'Notifications', href: '/admin/notifications' }, { label: 'Reminder jobs', href: '/admin/notifications/jobs' }, { label: 'Resources', href: '/admin/resources' },
];
const adminActive = (loc: string, href: string) => href === '/admin' || href === '/admin/schedule' || href === '/admin/notifications' ? loc === href : loc === href || loc.startsWith(`${href}/`);

function AdminMenu({ alwaysVisible = false, live = false, role = 'admin' }: { alwaysVisible?: boolean; live?: boolean; role?: string }) {
  const [location] = useLocation();
  return (
    <Sheet>
      <SheetTrigger asChild>
        <button type="button" aria-label={live ? 'Open admin navigation' : 'Open admin navigation preview'} data-testid="button-admin-menu"
          aria-haspopup="dialog" className={`inline-flex size-11 items-center justify-center rounded-lg text-navy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue ${alwaysVisible ? '' : role === 'admin' ? 'xl:hidden' : 'md:hidden'}`}>
          <Menu size={22} aria-hidden="true" />
        </button>
      </SheetTrigger>
      <SheetContent className="admin-menu-sheet flex h-full max-h-[100dvh] flex-col bg-white text-navy supports-[height:100dvh]:h-[100dvh] pt-[max(24px,env(safe-area-inset-top))] pb-[env(safe-area-inset-bottom)]">
        <SheetHeader className="shrink-0 pr-8"><SheetTitle className="alliance-display text-navy">Admin navigation</SheetTitle></SheetHeader>
        {live ? (
          <nav aria-label="Admin navigation" data-testid="admin-menu-nav" className="mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pb-[max(16px,env(safe-area-inset-bottom))]">
            {adminItems.map(({ label, href }) => href ? (
              <SheetClose asChild key={label}>
                <Link href={href} aria-current={adminActive(location, href) ? 'page' : undefined}
                  data-testid={`admin-menu-link-${label.toLowerCase().replace(/\s+/g, '-')}`}
                  className={`block min-h-11 rounded-lg px-4 py-2.5 font-bold focus-visible:outline-2 focus-visible:outline-blue ${adminActive(location, href) ? 'bg-navy text-white' : 'bg-gray'}`}>{label}</Link>
              </SheetClose>
            ) : (
              <div key={label} aria-disabled="true" className="flex min-h-11 items-center justify-between rounded-lg bg-gray px-4 py-2.5">{label}<span className="text-xs">Coming later</span></div>
            ))}
          </nav>
        ) : (<>
          <p className="mt-3 text-sm">Layout preview only. Portal features are not built yet.</p>
          <nav aria-label="Admin navigation preview" className="mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pb-[max(16px,env(safe-area-inset-bottom))]">
            {adminNav.map(label => <div key={label} className="min-h-11 rounded-lg bg-gray px-4 py-2.5">{label}</div>)}
          </nav>
        </>)}
      </SheetContent>
    </Sheet>
  );
}

export function AppLayout({ children, role = 'volunteer', preview = false }: {
  children: ReactNode; role?: 'volunteer' | 'admin'; preview?: boolean;
}) {
  const auth = useAuth();
  const [location] = useLocation();
  const [busy, setBusy] = useState(false);
  const userMenu = useRef<HTMLDetailsElement>(null);
  const live = !preview;
  const liveVolunteer = live && role === 'volunteer' && auth.session?.authenticated === true && auth.session.role === 'volunteer';
  const ctx = useGetMessageContext({ query: { queryKey: getGetMessageContextQueryKey(), enabled: liveVolunteer, staleTime: 30_000, refetchInterval: 45_000, retry: false }, request: FETCH_CREDS });
  const unread = liveVolunteer ? ctx.data?.unreadCount ?? 0 : 0;
  const badge = (href: string) => href === '/messages' && unread > 0
    ? <span className="ml-1 inline-flex min-w-5 items-center justify-center rounded-full bg-blue px-1.5 text-[14px] font-bold text-white" data-testid="badge-unread"><span aria-hidden="true">{unread > 99 ? '99+' : unread}</span><span className="sr-only"> {unread} unread</span></span> : null;
  const isActive = (href: string) => location === href || location.startsWith(`${href}/`);
  async function out() {
    setBusy(true);
    userMenu.current?.removeAttribute('open');
    await auth.signoutAndRedirect();
  }
  return (
    <div className={`relative bg-gray text-navy ${preview ? 'min-h-[320px] overflow-hidden rounded-2xl' : 'min-h-[100dvh]'}`} data-testid={`app-layout-${role}`}>
      {live && <TestAccountBanner />}
      <header className="border-b-[3px] border-navy bg-white">
        <div className={`mx-auto flex ${role === 'admin' ? 'max-w-7xl' : 'max-w-6xl'} items-center justify-between gap-3 px-4 py-3 md:px-6`}>
          <BrandMark />
          <nav className={`hidden shrink-0 items-center whitespace-nowrap text-sm text-navy ${role === 'admin' ? 'gap-0 xl:flex' : 'gap-1 lg:flex'}`} aria-label={live && role === 'volunteer' ? 'Volunteer navigation' : live ? 'Admin navigation' : `${role} navigation preview`}>
            {role === 'admin' && live
              ? adminItems.map(({ label, href }) => href ? (
                <Link key={label} href={href} aria-current={adminActive(location, href) ? 'page' : undefined}
                  className={`inline-flex min-h-11 items-center rounded-lg px-2 py-2 font-semibold hover:bg-gray focus-visible:outline-2 focus-visible:outline-blue ${adminActive(location, href) ? 'text-blue underline decoration-blue decoration-2 underline-offset-8' : ''}`}>{label}</Link>
              ) : <span key={label} aria-disabled="true" title="Coming later" className="hidden px-3 xl:inline">{label} <span className="text-xs">soon</span></span>)
              : role === 'admin' || !live
              ? (role === 'admin' ? adminNav : volunteerNav.map(i => i.label)).map(label => <span key={label} className="px-3">{label}</span>)
              : volunteerNav.map(({ label, href }) => (
                <Link key={href} href={href} aria-current={isActive(href) ? 'page' : undefined} data-testid={`nav-${href.slice(1)}`}
                  className={`rounded-lg px-3 py-2 font-semibold transition-colors hover:bg-gray focus-visible:outline-2 focus-visible:outline-blue ${isActive(href) ? 'text-blue underline decoration-blue decoration-2 underline-offset-8' : ''}`}>{label}{badge(href)}</Link>
              ))}
          </nav>
          <div className="flex items-center gap-2">
            {role === 'admin' && <AdminMenu live={live} role={role} />}
            <details ref={userMenu} className="relative text-navy" data-testid="menu-user">
              <summary className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-full border-[1.5px] border-navy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue" aria-label={live ? 'Open user menu' : 'Open user menu preview'} data-testid="button-user-menu"><UserRound size={20} aria-hidden="true" /></summary>
              <div className="absolute right-0 z-20 mt-2 w-60 max-w-[calc(100vw-2rem)] rounded-xl bg-white p-2 text-sm text-navy shadow-lg">
                {live ? (
                  <>
                    <p className="truncate px-3 py-2 text-sm text-navy-soft">{auth.session?.email ?? 'Signed in'}</p>
                    <Link href="/profile" data-testid="link-menu-profile" className="flex min-h-11 items-center rounded-lg px-3 font-bold hover:bg-gray">My profile</Link>
                    <button type="button" onClick={() => { void out(); }} disabled={busy} data-testid="button-signout" className="flex min-h-11 w-full items-center rounded-lg px-3 text-left font-bold hover:bg-gray disabled:opacity-50">{busy ? 'Signing out' : 'Sign out'}</button>
                  </>
                ) : <div className="p-2"><p className="font-bold">User menu preview</p><p className="mt-2">Account actions appear here when signed in.</p></div>}
              </div>
            </details>
          </div>
        </div>
      </header>
      <main className="mx-auto min-w-0 max-w-6xl px-4 py-6 pb-28 md:px-6 lg:pb-8">{children}</main>
      {role === 'volunteer' && (
        <nav className={`${preview ? 'absolute' : 'fixed'} inset-x-0 bottom-0 z-10 grid grid-cols-5 border-t border-gray bg-white px-1 pb-[max(10px,env(safe-area-inset-bottom))] pt-1 lg:hidden`} aria-label={live ? 'Volunteer navigation' : 'Volunteer navigation preview'} data-testid="volunteer-bottom-tabs">
          {volunteerNav.map(({ label, href, icon: Icon }) => live ? (
            <Link key={href} href={href} aria-current={isActive(href) ? 'page' : undefined} data-testid={`tab-${href.slice(1)}`}
              className={`flex min-h-12 min-w-11 flex-col items-center justify-center gap-0.5 rounded-lg py-1.5 focus-visible:outline-2 focus-visible:outline-blue ${isActive(href) ? 'font-bold text-blue' : 'text-navy'}`}>
              <span className="relative"><Icon size={20} aria-hidden="true" />{href === '/messages' && unread > 0 && <span className="absolute -right-2 -top-1 size-2.5 rounded-full bg-blue" aria-hidden="true" />}</span><span className="whitespace-nowrap text-[13px] font-bold leading-tight">{label}{href === '/messages' && unread > 0 && <span className="sr-only"> {unread} unread</span>}</span>
              <span className={`h-0.5 w-5 rounded-full ${isActive(href) ? 'bg-blue' : 'bg-transparent'}`} aria-hidden="true" />
            </Link>
          ) : (
            <div key={label} className="flex flex-col items-center gap-1 py-2 text-navy">
              <Icon size={20} aria-hidden="true" /><span className="text-xs font-bold">{label}</span>
            </div>
          ))}
        </nav>
      )}
    </div>
  );
}

export function AdminSheetPreview() {
  return (
    <div className="mx-auto max-w-[320px] overflow-hidden rounded-2xl border border-gray bg-white shadow-sm" data-testid="admin-sheet-preview">
      <header className="flex items-center justify-between gap-3 border-b-[3px] border-navy bg-white p-4"><BrandMark /><AdminMenu alwaysVisible /></header>
      <div className="p-5"><p className="alliance-label">Admin layout</p><p className="mt-3">Open the menu to review the mobile navigation sheet. No portal features are active.</p></div>
    </div>
  );
}

export function StyleGuideLink() {
  return import.meta.env.DEV ? <Link href="/style-guide" className="text-blue underline underline-offset-4" data-testid="link-style-guide">View the development style guide</Link> : null;
}
