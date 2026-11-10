import { useState, type FormEvent } from 'react';
import { Alert, Button, Modal, SecondaryButton, TextArea } from './ui';

// Asks for the reason behind a rejection or reopening. It's shown to the employee.
export function ReasonDialog({ title, action, label = 'Reason (the employee will see this)', onClose, onSubmit }: {
  title: string;
  action: string;
  label?: string;
  onClose: () => void;
  onSubmit: (note: string) => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await onSubmit(note);
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <TextArea label={label} required minLength={3} maxLength={500} rows={3} autoFocus value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="flex justify-end gap-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <Button type="submit" disabled={submitting}>{submitting ? 'Saving…' : action}</Button>
        </div>
      </form>
    </Modal>
  );
}
