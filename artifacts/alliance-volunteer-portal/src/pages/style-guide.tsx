import { ArrowRight, HeartHandshake } from 'lucide-react';
import { appConfig } from '@workspace/shared/appConfig';
import { AppLayout, AdminSheetPreview, Button, Card, EmptyState, Input, PublicLayout, StatusBadge } from '@/components/brand-system';

function SectionHeading({ number, title, note }: { number: string; title: string; note?: string }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4 border-b border-[#06365D]/10 pb-3">
      <div>
        <span className="alliance-section-kicker">{number} / Visual system</span>
        <h2 className="alliance-display mt-2 text-[16px] text-[#06365D]">{title}</h2>
      </div>
      {note && <span className="hidden text-xs text-[#06365D]/55 sm:block">{note}</span>}
    </div>
  );
}

function Swatch({ name, hex, styleName }: { name: string; hex: string; styleName: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[#06365D]/10 bg-white" data-testid={`swatch-${styleName}`}>
      <div className="h-20" style={{ backgroundColor: hex }} />
      <div className="p-3">
        <p className="text-sm font-bold">{name}</p>
        <p className="mt-1 font-mono text-xs text-[#06365D]/60">{hex}</p>
      </div>
    </div>
  );
}

export default function StyleGuide() {
  return (
    <PublicLayout contained={false}>
      <div className="mx-auto max-w-6xl px-5 py-10 md:px-8 md:py-16">
        <div className="mb-12 grid gap-6 border-b border-[#06365D]/10 pb-9 md:grid-cols-[1fr_260px] md:items-end">
          <div>
            <p className="alliance-section-kicker">Development only · review canvas</p>
            <h1 className="alliance-display mt-3 text-[22px] text-[#06365D] md:text-[28px]" data-testid="text-style-guide-title">{appConfig.orgName} visual system</h1>
            <p className="mt-4 max-w-2xl text-base text-[#06365D]/75">A steady, human interface for locally rooted community care in {appConfig.defaultCounty} County.</p>
          </div>
          <div className="rounded-xl bg-[#edf4f5] p-4 text-xs leading-5 text-[#06365D]/70">
            <span className="font-bold uppercase tracking-wider text-[#027A77]">Design balance</span>
            <p className="mt-1">60% navy · 25% white · 10% light gray · 5% teal</p>
          </div>
        </div>

        <div className="space-y-14">
          <section>
            <SectionHeading number="01" title="Color" note="Teal stays focused on action and labels." />
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <Swatch name="Navy" hex="#06365D" styleName="navy" />
              <Swatch name="Teal" hex="#02928F" styleName="teal" />
              <Swatch name="Teal text" hex="#027A77" styleName="teal-text" />
              <Swatch name="Gray" hex="#E6E6E6" styleName="gray" />
              <Swatch name="White" hex="#FFFFFF" styleName="white" />
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <div className="rounded-lg bg-white px-4 py-2 text-xs font-semibold text-navy-soft">Navy-soft sample: 60% opacity</div>
              <div className="rounded-lg bg-[#FFF0D2] px-4 py-2 text-xs font-semibold text-[#785213]">Attention · soft amber</div>
              <div className="rounded-lg bg-[#FBE4E1] px-4 py-2 text-xs font-semibold text-[#8E332A]">Blocked · soft red</div>
            </div>
          </section>

          <section>
            <SectionHeading number="02" title="Type" />
            <div className="alliance-card grid gap-6 md:grid-cols-[1fr_1fr]">
              <div>
                <p className="alliance-label">Display · Lulo Clean / Montserrat 800</p>
                <p className="alliance-display mt-3 text-[20px] text-[#06365D]">A stronger community</p>
                <p className="mt-2 text-xs text-[#06365D]/55">Uppercase · .06em tracking</p>
                <p className="mt-2 text-xs text-navy-soft">{__HAS_LULO_FONT__ ? 'Lulo Clean is installed.' : 'Lulo Clean has not been supplied. Montserrat 800 is the active fallback.'}</p>
              </div>
              <div className="space-y-4">
                <div>
                  <p className="alliance-label">Subheader / field label · 15px bold</p>
                  <p className="mt-2 text-[17px] leading-[1.55]">Body copy uses Open Sans at 17px with a 1.55 line-height. Clear language gives every neighbor room to understand what comes next.</p>
                </div>
                <p className="text-sm text-[#06365D]/60">Supporting text remains navy-soft: quiet, legible, and never competing with the message.</p>
              </div>
            </div>
          </section>

          <section>
            <SectionHeading number="03" title="Actions & fields" />
            <div className="alliance-card grid gap-8 md:grid-cols-[1fr_1fr]">
              <div>
                <p className="alliance-label mb-4">Button variants</p>
                <div className="flex flex-wrap gap-3">
                  <Button data-testid="button-primary-sample">Primary action</Button>
                  <Button variant="secondary" data-testid="button-secondary-sample">Secondary</Button>
                </div>
                <p className="mt-3 text-xs text-[#06365D]/55">Hover states deepen navy or fill with teal.</p>
              </div>
              <div>
                <label htmlFor="guide-input" className="alliance-label mb-2 block">Field label</label>
                <Input id="guide-input" placeholder="Type a short response" data-testid="input-example" />
                <p className="mt-2 text-xs text-[#06365D]/55">Gray fill · 8px radius · focus ring shown below</p>
                <div className="mt-4 rounded-xl bg-[#f8fafb] p-4">
                  <label htmlFor="guide-focus" className="alliance-label mb-2 block">Focused input state</label>
                  <Input id="guide-focus" defaultValue="A clear, calm field" className="ring-2 ring-[#02928F]" data-testid="input-focus-example" />
                </div>
              </div>
            </div>
          </section>

          <section>
            <SectionHeading number="04" title="Status & feedback" />
            <div className="alliance-card">
              <div className="flex flex-wrap gap-3">
                <StatusBadge status="neutral">Neutral</StatusBadge>
                <StatusBadge status="good">Good</StatusBadge>
                <StatusBadge status="attention">Needs attention</StatusBadge>
                <StatusBadge status="blocked">Blocked</StatusBadge>
              </div>
              <div className="mt-6 grid gap-4 md:grid-cols-[.9fr_1.1fr]">
                <div className="space-y-4">
                  <EmptyState title="A little room to begin" description="Nothing to show here yet. When something is ready, it will appear in this space." />
                  <EmptyState title="With an optional action" description="A helpful next step can appear here." action={<Button data-testid="button-empty-state-example">Sample action</Button>} />
                </div>
                <div>
                  <p className="alliance-label mb-3">Card surface</p>
                  <Card>
                    <p className="alliance-section-kicker">A note from the community</p>
                    <h3 className="alliance-display mt-3 text-[15px] text-[#06365D]">Care moves at a human pace</h3>
                    <p className="mt-2 text-sm text-[#06365D]/75">Simple surfaces and thoughtful spacing help people find their footing without adding noise.</p>
                    <div className="mt-4 flex items-center gap-2 text-xs font-bold text-[#027A77]">A sample card <ArrowRight size={14} /></div>
                  </Card>
                </div>
              </div>
            </div>
          </section>

          <section>
            <SectionHeading number="05" title="Shells & navigation" note="Layout previews only · no account actions." />
            <div className="space-y-5">
              <div>
                <p className="alliance-label mb-3">PublicLayout · entry shell</p>
                <div className="overflow-hidden rounded-2xl border border-[#06365D]/10 bg-[#f8fafb]">
                  <div className="flex items-center justify-between bg-navy px-5 py-4 text-white">
                    <div className="alliance-display text-[12px]">{appConfig.appName}</div>
                    <span className="hidden text-xs sm:block">{appConfig.defaultCounty} County</span>
                  </div>
                  <div className="px-5 py-9 md:px-8">
                    <p className="alliance-section-kicker">Neighbors showing up for neighbors</p>
                    <p className="alliance-display mt-3 text-lg">A welcoming public shell</p>
                    <p className="mt-2 max-w-lg text-sm text-[#06365D]/70">A quiet header, clear content area, and local footer set the tone without introducing a workflow.</p>
                  </div>
                </div>
              </div>
              <div>
                <p className="alliance-label mb-3">AppLayout · signed-in shell example</p>
                <AppLayout preview>
                  <div className="grid gap-5 md:grid-cols-[1.2fr_.8fr]">
                    <Card>
                      <p className="alliance-section-kicker">Volunteer view sample</p>
                      <h3 className="alliance-display mt-3 text-[16px]">A shell with space to breathe</h3>
                      <p className="mt-2 text-sm text-[#06365D]/70">Navigation shown as a static structure. No account screen or action is active.</p>
                    </Card>
                    <Card className="flex items-center gap-4">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#e8f4f3] text-[#027A77]"><HeartHandshake size={21} /></div>
                      <div><p className="alliance-label text-xs">Locally oriented</p><p className="mt-1 text-sm">Made for neighbors in {appConfig.defaultCounty} County.</p></div>
                    </Card>
                  </div>
                </AppLayout>
              </div>
              <div className="grid gap-6 md:grid-cols-2">
                <div>
                  <p className="alliance-label mb-3">Volunteer · mobile bottom tabs</p>
                  <div className="relative mx-auto h-[315px] max-w-[310px] overflow-hidden rounded-[24px] border-[6px] border-[#06365D] bg-[#f3f7f8] shadow-lg">
                    <div className="flex items-center justify-between bg-navy px-4 py-3 text-white"><span className="alliance-display text-[10px]">{appConfig.orgName}</span><span className="h-7 w-7 rounded-full border border-white/40 text-center text-[10px] font-bold leading-7">AV</span></div>
                    <div className="p-4"><div className="h-5 w-32 rounded bg-[#06365D]/10" /><div className="mt-3 h-3 w-full rounded bg-[#06365D]/10" /><div className="mt-2 h-3 w-3/4 rounded bg-[#06365D]/10" /><div className="mt-6 h-24 rounded-xl bg-white shadow-sm" /></div>
                    <div className="absolute inset-x-0 bottom-0 grid grid-cols-3 border-t border-[#06365D]/10 bg-white px-2 pb-3 pt-2">
                      <div className="text-center text-[#027A77]"><div className="flex justify-center"><span className="rounded-full bg-[#e8f4f3] p-1"><span className="block h-3 w-3 rounded-sm bg-[#02928F]" /></span></div><span className="mt-1 block text-[9px] font-bold">HOME</span></div>
                      <div className="text-center text-[#06365D]/55"><div className="mx-auto mt-1 h-4 w-4 rounded border border-current" /><span className="mt-1 block text-[9px] font-bold">SHIFTS</span></div>
                      <div className="text-center text-[#06365D]/55"><div className="mx-auto mt-1 h-4 w-4 rounded-full border border-current" /><span className="mt-1 block text-[9px] font-bold">PROFILE</span></div>
                    </div>
                  </div>
                  <p className="mt-2 text-center text-xs text-[#06365D]/55">Pinned navigation preview · not interactive</p>
                </div>
                <div>
                  <p className="alliance-label mb-3">Admin · hamburger sheet</p>
                  <AdminSheetPreview />
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </PublicLayout>
  );
}
