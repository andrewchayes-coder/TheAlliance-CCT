import { ArrowRight } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { appConfig } from '@workspace/shared/appConfig';
import { AppLayout, AdminSheetPreview, Button, Card, EmptyState, Input, PublicLayout, StatusBadge } from '@/components/brand-system';

const base = import.meta.env.BASE_URL;

function SectionHeading({ number, title, note }: { number: string; title: string; note?: string }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4 border-b border-gray pb-3">
      <div>
        <span className="alliance-section-kicker">{number}</span>
        <h2 className="mt-1">{title}</h2>
      </div>
      {note && <span className="hidden text-sm text-navy sm:block">{note}</span>}
    </div>
  );
}

function Swatch({ name, hex, styleName, usage }: { name: string; hex: string; styleName: string; usage: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray bg-white" data-testid={`swatch-${styleName}`}>
      <div className="h-20 border-b border-gray" style={{ backgroundColor: hex }} />
      <div className="p-3">
        <p className="text-[15px] font-bold">{name}</p>
        <p className="mt-1 font-mono text-sm">{hex}</p>
        <p className="mt-1 text-sm">{usage}</p>
      </div>
    </div>
  );
}

function EmailPreview() {
  return (
    <div className="mx-auto max-w-[600px] overflow-hidden rounded-xl border border-gray bg-white" data-testid="email-preview">
      <div className="border-b-4 border-navy bg-white px-6 py-5">
        <img src={`${base}brand/logo-horizontal.png`} width={240} alt={`${appConfig.orgName} ${appConfig.programName}`} className="h-auto w-[240px] max-w-full" />
      </div>
      <div className="px-6 py-6">
        <h3 className="!text-navy">Thank you for showing up for your neighbors</h3>
        <p className="mt-3">Your Tuesday shift is confirmed. Families across Sacramento are counting on the care you bring, and we are glad you are part of this team.</p>
        <span className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-blue px-5 text-[15px] font-bold text-white">View my shift</span>
      </div>
      <div className="border-t border-gray px-6 py-5 text-[15px] leading-relaxed">{appConfig.missionLine}</div>
    </div>
  );
}

export default function StyleGuide() {
  return (
    <PublicLayout contained={false}>
      <div className="mx-auto max-w-6xl px-5 py-10 md:px-8 md:py-16">
        <div className="mb-12 border-b border-gray pb-9">
          <PageHeader eyebrow="Development only" title={`${appConfig.programName} visual system`} titleTestId="text-style-guide-title" description={<>
            <p>A warm, hopeful, and respectful interface for neighbors serving neighbors in the Greater Sacramento Area.</p>
            <p className="mt-3 text-[15px]">Balance: 60% navy, 25% white, 10% gray, 5% blue. Blue is for actions and labels, never large fills.</p>
          </>} className="mb-0" />
        </div>

        <div className="space-y-14">
          <section>
            <SectionHeading number="01" title="Color tokens" note="Blue never sits as text on gray." />
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Swatch name="Navy" hex="#06365D" styleName="navy" usage="Headings, body, navigation" />
              <Swatch name="Alliance Blue" hex="#0175AA" styleName="blue" usage="Subheaders, links, actions" />
              <Swatch name="Gray" hex="#E6E6E6" styleName="gray" usage="Inputs, subtle fills, borders" />
              <Swatch name="White" hex="#FFFFFF" styleName="white" usage="Surfaces" />
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <div className="rounded-lg bg-[#FFF0D2] px-4 py-2 text-[15px] font-semibold text-[#785213]">Attention</div>
              <div className="rounded-lg bg-[#FBE4E1] px-4 py-2 text-[15px] font-semibold text-[#8E332A]">Blocked</div>
            </div>
          </section>

          <section>
            <SectionHeading number="02" title="Type scale" note="Open Sans 400, 600, 700" />
            <div className="alliance-card space-y-5">
              <div><p className="text-[15px] font-bold">h1 · Bold 28px navy (22px on mobile), sentence case</p><h1 className="mt-1">Welcome to the team</h1></div>
              <div><p className="text-[15px] font-bold">h2 · Bold 22px navy</p><h2 className="mt-1">Your upcoming shifts</h2></div>
              <div><p className="text-[15px] font-bold">Subheader · Bold 18px blue</p><h3 className="mt-1">Tuesday morning</h3></div>
              <div><p className="text-[15px] font-bold">Field label · Bold 15px navy</p><p className="mt-1 text-[15px] font-bold">Mobile phone</p></div>
              <div><p className="text-[15px] font-bold">Body · Regular 17px / 1.55 navy</p><p className="mt-1">Clear, kind language gives every neighbor room to understand what comes next.</p></div>
            </div>
          </section>

          <section>
            <SectionHeading number="03" title="Buttons and inputs" />
            <div className="alliance-card grid gap-8 md:grid-cols-2">
              <div>
                <h3 className="mb-4">Buttons</h3>
                <div className="flex flex-wrap gap-3">
                  <Button data-testid="button-primary-sample">Primary action</Button>
                  <Button variant="secondary" data-testid="button-secondary-sample">Secondary</Button>
                </div>
                <p className="mt-3 text-[15px]">Primary: blue, hover navy. Secondary: white with 1.5px blue border; hover fills blue with white text.</p>
                <p className="mt-3"><a href="#links" className="font-bold text-blue underline-offset-4 hover:underline">A link in blue</a></p>
              </div>
              <div>
                <label htmlFor="guide-input" className="mb-2 block">Field label</label>
                <Input id="guide-input" placeholder="Type a short response" data-testid="input-example" />
                <p className="mt-2 text-[15px]">Gray fill, no border, 8px radius, placeholder at 60% navy.</p>
                <div className="mt-4 rounded-xl bg-white p-4">
                  <label htmlFor="guide-focus" className="mb-2 block">Focused state</label>
                  <Input id="guide-focus" defaultValue="A clear, calm field" className="ring-2 ring-blue" data-testid="input-focus-example" />
                </div>
              </div>
            </div>
          </section>

          <section>
            <SectionHeading number="04" title="Badges and feedback" />
            <div className="alliance-card">
              <div className="flex flex-wrap gap-3">
                <StatusBadge status="neutral">Neutral</StatusBadge>
                <StatusBadge status="good">Good</StatusBadge>
                <StatusBadge status="attention">Needs attention</StatusBadge>
                <StatusBadge status="blocked">Blocked</StatusBadge>
              </div>
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <EmptyState title="A little room to begin" description="Nothing here yet. When something is ready, it will appear in this space." action={<Button data-testid="button-empty-state-example">Sample action</Button>} />
                <Card>
                  <h3>Care moves at a human pace</h3>
                  <p className="mt-2">Simple surfaces and thoughtful spacing help people find their footing.</p>
                  <div className="mt-4 flex items-center gap-2 text-[15px] font-bold text-blue">A sample card <ArrowRight size={14} aria-hidden="true" /></div>
                </Card>
              </div>
            </div>
          </section>

          <section>
            <SectionHeading number="05" title="Logos" note="Navy on transparent. Use on white only." />
            <div className="grid gap-4 md:grid-cols-[1.4fr_1fr]">
              <div className="alliance-card"><p className="mb-3 text-[15px] font-bold">logo-horizontal.png · app header (40px tall)</p><img src={`${base}brand/logo-horizontal.png`} alt="The Alliance Community Care Team, horizontal" className="h-10 w-auto" /><p className="mb-3 mt-6 text-[15px] font-bold">logo-mark.png · mobile header (36px)</p><img src={`${base}brand/logo-mark.png`} alt="Community Care Team mark" className="h-9 w-auto" /></div>
              <div className="alliance-card"><p className="mb-3 text-[15px] font-bold">logo-stacked.png · public pages (max 240px) and home-screen icons on white</p><img src={`${base}brand/logo-stacked.png`} alt="The Alliance Community Care Team, stacked" className="h-auto w-full max-w-[240px]" /></div>
            </div>
          </section>

          <section>
            <SectionHeading number="06" title="Email preview" note="White header, 4px navy rule, blue button, mission footer." />
            <EmailPreview />
          </section>

          <section>
            <SectionHeading number="07" title="Shells and navigation" note="Layout previews only." />
            <div className="space-y-5">
              <AppLayout preview>
                <Card>
                  <h3>A shell with space to breathe</h3>
                  <p className="mt-2">White header, 3px navy rule, navy navigation, active item in blue with a 2px underline.</p>
                </Card>
              </AppLayout>
              <div className="max-w-sm"><AdminSheetPreview /></div>
            </div>
          </section>
        </div>
      </div>
    </PublicLayout>
  );
}
