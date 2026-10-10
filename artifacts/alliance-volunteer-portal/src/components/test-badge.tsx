export function TestBadge({ test }: { test?: boolean }) {
  return test ? <span className="ml-2 inline-block rounded bg-[#ECEEEE] px-2 py-0.5 align-middle text-[11px] font-bold tracking-wide text-navy" aria-label="Test account">TEST</span> : null;
}
