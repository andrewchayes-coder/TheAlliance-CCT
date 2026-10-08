import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { TYPES, countOf, monthName, typeLabel, type Summary } from './shared';

type Row = Record<string, number | string>;

function Tip({ active, payload }: { active?: boolean; payload?: { payload: Row }[] }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="rounded-lg border border-gray bg-white p-3 text-sm shadow-md" data-testid="chart-tooltip">
      <p className="font-bold">{String(r.full)}{r.current ? ' (month so far)' : ''}</p>
      <p className="mb-1">Total: <b className="tabular-nums">{String(r.total)}</b></p>
      {TYPES.map(t => <p key={t.type} className="flex items-center gap-2"><span className="size-2.5 rounded-sm" style={{ background: t.color }} />{t.label}: <b className="tabular-nums">{String(r[t.type])}</b></p>)}
    </div>
  );
}

export function UsageChart({ s }: { s: Summary }) {
  const data: Row[] = s.months.map(m => ({
    label: monthName(m.month), full: monthName(m.month, true), total: m.total, current: m.month === s.month ? 1 : 0,
    ...Object.fromEntries(TYPES.map(t => [t.type, countOf(m.byType, t.type)])),
  }));
  return (
    <div>
      <div className="h-72 w-full" role="img" aria-label="Stacked column chart of emails per month by type, details in the table below" data-testid="chart-monthly">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="#d9dee5" />
            <XAxis dataKey="label" tickLine={false} />
            <YAxis allowDecimals={false} tickFormatter={(v: number) => String(Math.round(v))} tickLine={false} />
            <Tooltip content={<Tip />} cursor={{ fill: 'rgba(31,58,95,0.06)' }} />
            <Legend formatter={(v: string) => typeLabel(v)} wrapperStyle={{ fontSize: 14 }} />
            {TYPES.map(t => <Bar key={t.type} dataKey={t.type} name={t.type} stackId="a" fill={t.color} isAnimationActive={false} />)}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-3 text-sm">
        <summary className="flex min-h-11 cursor-pointer items-center font-bold" data-testid="toggle-chart-table">View chart data as a table</summary>
        <ul className="mt-2 space-y-2 lg:hidden" aria-label="Emails per month by type">
          {s.months.map(m => (
            <li key={m.month} className="rounded-xl border border-gray p-3">
              <p className="font-bold">{monthName(m.month, true)}{m.month === s.month ? ' (so far)' : ''}: <span className="tabular-nums">{m.total}</span> total</p>
              <dl className="mt-1 grid grid-cols-2 gap-x-3 text-sm tabular-nums">{TYPES.map(t => <div key={t.type} className="flex justify-between gap-2"><dt>{t.label}</dt><dd className="font-bold">{countOf(m.byType, t.type)}</dd></div>)}</dl>
            </li>
          ))}
        </ul>
        <div className="mt-2 hidden lg:block">
          <table className="w-full text-left text-sm tabular-nums" data-testid="table-monthly">
            <caption className="sr-only">Emails per month by type</caption>
            <thead><tr><th className="py-1 pr-2">Month</th>{TYPES.map(t => <th key={t.type} className="px-1">{t.label}</th>)}<th className="px-1">Total</th></tr></thead>
            <tbody>{s.months.map(m => (
              <tr key={m.month} className="border-t border-gray"><th className="py-1 pr-2 font-bold">{monthName(m.month, true)}{m.month === s.month ? ' (so far)' : ''}</th>
                {TYPES.map(t => <td key={t.type} className="px-1">{countOf(m.byType, t.type)}</td>)}<td className="px-1 font-bold">{m.total}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
