export function OneTimeTag({ className = '' }: { className?: string }) {
  return <span data-testid="tag-one-time" className={`inline-block rounded border border-dashed border-blue bg-white px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-blue ${className}`}>One-time</span>;
}
