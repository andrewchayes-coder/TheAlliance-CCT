import { useEffect, useRef, type ReactNode } from 'react';

export function Dlg({ title, id, onClose, busy = false, testid, children }: {
  title: string; id: string; onClose: () => void; busy?: boolean; testid: string; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal(); }, []);
  return (
    <dialog ref={ref} aria-labelledby={id} data-testid={testid} onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}
      className="m-auto w-[min(94vw,36rem)] max-h-[90dvh] overflow-y-auto rounded-2xl p-5 text-navy shadow-xl backdrop:bg-black/50">
      <h2 id={id} className="alliance-display text-[18px]">{title}</h2>
      {children}
    </dialog>
  );
}
