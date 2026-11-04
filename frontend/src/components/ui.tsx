import { useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Logo } from './Logo';

export function Field({ label, ...props }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <input
        {...props}
        className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-navy outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20"
      />
    </label>
  );
}

export function TextArea({ label, ...props }: { label: string } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <textarea
        {...props}
        className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal text-navy outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20"
      />
    </label>
  );
}

export function Button({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    />
  );
}

export function SecondaryButton({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    />
  );
}

export function RowAction({ danger, ...props }: { danger?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const color = danger ? 'text-red-700' : 'text-brand-700';
  return <button type="button" {...props} className={`text-sm font-medium hover:underline disabled:opacity-50 ${color}`} />;
}

export function Select({ label, children, ...props }: { label: string } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <select
        {...props}
        className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-navy outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20"
      >
        {children}
      </select>
    </label>
  );
}

// The native dialog element provides focus trapping and closing with Esc.
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      className="m-auto w-full max-w-lg rounded-2xl bg-white p-6 text-navy shadow-xl backdrop:bg-slate-900/40"
    >
      <h2 className="text-lg font-bold">{title}</h2>
      <div className="mt-4">{children}</div>
    </dialog>
  );
}

export function DataTable({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 text-slate-600">
          <tr>{headers.map((h) => <th key={h} className="px-3 py-3 font-medium xl:px-4 xl:whitespace-nowrap">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100 [&_td]:px-3 [&_td]:py-3 xl:[&_td]:px-4">{children}</tbody>
      </table>
    </div>
  );
}

export function Alert({ kind = 'error', children }: { kind?: 'error' | 'success'; children: ReactNode }) {
  const colors = kind === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-green-200 bg-green-50 text-green-800';
  return <p role="alert" className={`rounded-lg border px-3 py-2 text-sm ${colors}`}>{children}</p>;
}

export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <Logo />
        <h1 className="mt-4 text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
        <div className="mt-5">{children}</div>
      </div>
    </main>
  );
}

export const roleLabel = { EMPLOYEE: 'Employee', MANAGER: 'Manager', ADMIN: 'Admin' } as const;
