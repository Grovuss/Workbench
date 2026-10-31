import { useState, type FormEvent } from 'react';
import { FolderMinus } from 'lucide-react';
import Modal from './Modal';

interface Props {
  title: string;
  /** The current group name, if there is one. */
  initial: string | null;
  /** Existing groups to pick from; leave empty to only type a name. */
  groups: string[];
  submitLabel: string;
  /** Shown as a button that clears the group, when given. */
  removeLabel?: string;
  onSubmit: (name: string | null) => Promise<void> | void;
  onClose: () => void;
}

/** Picks or names a profile group: moving a profile into one, or renaming one. */
export default function GroupModal({ title, initial, groups, submitLabel, removeLabel, onSubmit, onClose }: Props) {
  const [name, setName] = useState(initial ?? '');
  const [busy, setBusy] = useState(false);
  const clean = name.trim();

  const submit = async (value: string | null) => {
    setBusy(true);
    try {
      await onSubmit(value);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const onFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (clean) submit(clean);
  };

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          {removeLabel && initial && (
            <button className="btn btn-ghost modal-footer-start" onClick={() => submit(null)} disabled={busy}>
              <FolderMinus size={15} /> {removeLabel}
            </button>
          )}
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" type="submit" form="group-form" disabled={!clean || clean === initial || busy}>
            {submitLabel}
          </button>
        </>
      }
    >
      <form id="group-form" onSubmit={onFormSubmit}>
        <input
          className="input"
          value={name}
          maxLength={40}
          placeholder="Group name, like “Modded” or “With friends”"
          autoFocus
          onChange={(e) => setName(e.target.value)}
          aria-label="Group name"
        />
      </form>
      {groups.length > 0 && (
        <div className="group-choices" role="group" aria-label="Existing groups">
          {groups.map((g) => (
            <button key={g} className="chip" aria-pressed={g === clean} onClick={() => setName(g)}>
              {g}
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
