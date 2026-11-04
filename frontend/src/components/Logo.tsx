import { Clock } from 'lucide-react';

// The one place to swap in the company logo.
export function Logo({ small }: { small?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2 font-extrabold tracking-tight text-navy ${small ? 'text-base' : 'text-xl'}`}>
      <Clock className="text-brand-500" size={small ? 20 : 26} strokeWidth={2.5} aria-hidden />
      TimeSheet
    </span>
  );
}
