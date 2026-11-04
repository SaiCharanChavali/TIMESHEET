import { parseShiftTime, toShiftTime } from '../lib/time';

const HOURS = ['12', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'];
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

const selectClass = 'min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 py-2 text-navy outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20';

// Used instead of a native time input, which can show 24-hour time depending on the computer's region settings.
export function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const { hour, minute, period } = parseShiftTime(value);

  return (
    <fieldset>
      <legend className="text-sm font-medium text-slate-700">{label}</legend>
      <div className="mt-1 flex gap-1.5">
        <select aria-label="Hour" className={selectClass} value={hour} onChange={(e) => onChange(toShiftTime(e.target.value, minute, period))}>
          {HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
        </select>
        <select aria-label="Minute" className={selectClass} value={minute} onChange={(e) => onChange(toShiftTime(hour, e.target.value, period))}>
          {MINUTES.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select aria-label="AM or PM" className={selectClass} value={period} onChange={(e) => onChange(toShiftTime(hour, minute, e.target.value))}>
          <option value="am">AM</option>
          <option value="pm">PM</option>
        </select>
      </div>
    </fieldset>
  );
}
