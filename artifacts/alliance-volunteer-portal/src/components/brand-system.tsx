import { type ReactNode } from 'react';
import { Home, CalendarDays, UserRound, Menu, HeartHandshake } from 'lucide-react';
import { Link } from 'wouter';
import { appConfig } from '@workspace/shared/appConfig';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';

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
      <h3 className="alliance-display text-[15px] text-navy">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-navy">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

function BrandMark() {
  return (
    <div className="min-w-0" data-testid="brand-mark">
      {__HAS_BRAND_LOGO__ ? (
        <img src={`${import.meta.env.BASE_URL}brand/logo.svg`} alt={appConfig.orgName} className="max-h-12 max-w-[240px]" />
      ) : (
        <span className="alliance-display block max-w-[280px] text-[12px] leading-relaxed text-white sm:max-w-none sm:text-[15px]">
          {appConfig.appName}
        </span>
      )}
    </div>
  );
}

export function PublicLayout({ children, contained = true }: { children: ReactNode; contained?: boolean }) {
  return (
    <div className="min-h-[100dvh] bg-white text-navy" data-testid="public-layout">
      <header className="bg-navy">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-6 md:px-8">
          <BrandMark />
          <span className="hidden text-xs font-semibold uppercase tracking-wider text-white sm:block">{appConfig.defaultCounty} County</span>
        </div>
      </header>
      {contained ? (
        <main className="flex min-h-[calc(100dvh-90px)] items-center justify-center px-4 py-10">
          <Card className="w-full max-w-xl">{children}</Card>
        </main>
      ) : <main>{children}</main>}
    </div>
  );
}

const volunteerNav = [
  { label: 'Home', icon: Home },
  { label: 'Shifts', icon: CalendarDays },
  { label: 'Profile', icon: UserRound },
];
const adminNav = ['Overview', 'Volunteers', 'Master schedule', 'Messages', 'Resources'];

function AdminMenu({ alwaysVisible = false }: { alwaysVisible?: boolean }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <button type="button" aria-label="Open admin navigation preview" data-testid="button-admin-menu"
          className={`rounded-lg p-3 text-white focus-visible:outline-2 focus-visible:outline-white ${alwaysVisible ? '' : 'md:hidden'}`}>
          <Menu size={22} aria-hidden="true" />
        </button>
      </SheetTrigger>
      <SheetContent className="bg-white text-navy">
        <SheetHeader><SheetTitle className="alliance-display text-base text-navy">Admin navigation</SheetTitle></SheetHeader>
        <p className="mt-3 text-sm">Layout preview only. Portal features are not built yet.</p>
        <nav aria-label="Admin navigation preview" className="mt-6 space-y-3">
          {adminNav.map(label => <div key={label} className="rounded-lg bg-gray px-4 py-3">{label}</div>)}
        </nav>
      </SheetContent>
    </Sheet>
  );
}

export function AppLayout({ children, role = 'volunteer', preview = false }: {
  children: ReactNode; role?: 'volunteer' | 'admin'; preview?: boolean;
}) {
  return (
    <div className={`relative bg-gray text-navy ${preview ? 'min-h-[320px] overflow-hidden rounded-2xl' : 'min-h-[100dvh]'}`} data-testid={`app-layout-${role}`}>
      <header className="bg-navy">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-5 md:px-6">
          <BrandMark />
          <nav className="hidden items-center gap-5 text-sm text-white md:flex" aria-label={`${role} navigation preview`}>
            {(role === 'admin' ? adminNav : volunteerNav.map(item => item.label)).map(label => <span key={label}>{label}</span>)}
          </nav>
          <div className="flex items-center gap-2">
            {role === 'admin' && <AdminMenu />}
            <details className="relative text-white">
              <summary className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-full border border-white/40" aria-label="Open user menu preview" data-testid="button-user-menu"><UserRound size={20} /></summary>
              <div className="absolute right-0 z-20 mt-2 w-56 rounded-xl bg-white p-4 text-sm text-navy shadow-lg">
                <p className="font-bold">User menu preview</p><p className="mt-2">Account actions will be added in a later step.</p>
              </div>
            </details>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 pb-24 md:px-6 md:pb-6">{children}</main>
      {role === 'volunteer' && (
        <nav className={`${preview ? 'absolute' : 'fixed'} inset-x-0 bottom-0 z-10 grid grid-cols-3 border-t border-gray bg-white px-3 pb-[max(10px,env(safe-area-inset-bottom))] pt-2 md:hidden`} aria-label="Volunteer navigation preview" data-testid="volunteer-bottom-tabs">
          {volunteerNav.map(({ label, icon: Icon }) => (
            <div key={label} className="flex flex-col items-center gap-1 py-2 text-navy">
              <Icon size={20} aria-hidden="true" /><span className="text-[10px] font-bold uppercase">{label}</span>
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
      <header className="flex items-center justify-between gap-3 bg-navy p-4"><BrandMark /><AdminMenu alwaysVisible /></header>
      <div className="p-5"><p className="alliance-label">Admin layout</p><p className="mt-3 text-sm">Open the menu to review the mobile navigation sheet. No portal features are active.</p></div>
    </div>
  );
}

export function StyleGuideLink() {
  return import.meta.env.DEV ? <Link href="/style-guide" className="text-teal-text underline underline-offset-4" data-testid="link-style-guide">View the development style guide</Link> : null;
}
