import { useId } from 'react';

export function ShiftFrequency({ once, onChange, disabled = false }: {
  once: boolean; onChange: (once: boolean) => void; disabled?: boolean;
}) {
  const name = useId();
  return (
    <fieldset disabled={disabled} className="mb-4">
      <legend className="mb-2 font-bold">How often would you like to help?</legend>
      <div className="flex flex-wrap gap-2">
        {[false, true].map(value => (
          <label key={String(value)} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-4 py-2 ${once === value ? 'border-blue bg-white font-bold' : 'border-navy/30 bg-gray'}`}>
            <input type="radio" name={name} checked={once === value} onChange={() => onChange(value)}
              className="h-5 w-5 accent-blue" data-testid={`frequency-${value ? 'once' : 'weekly'}`} />
            {value ? 'One time' : 'Recurring weekly'}
          </label>
        ))}
      </div>
      <p className="mt-2 text-sm">{once ? 'Choose a single date. This shift will not repeat or count toward your weekly shift limit.' : 'Your shift repeats each week until you change it.'}</p>
    </fieldset>
  );
}
