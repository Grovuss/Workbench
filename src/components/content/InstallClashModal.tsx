import { useState } from 'react';
import { PowerOff } from 'lucide-react';
import Modal from '../Modal';
import type { InstallClash } from '../../types';

interface Props {
  title: string;
  clash: InstallClash;
  /** Turns the clashing mod off, then installs. */
  onReplace: () => Promise<void>;
  onInstallAnyway: () => void;
  onClose: () => void;
}

/** Asks before installing a mod that clashes with one already in the profile. */
export default function InstallClashModal({ title, clash, onReplace, onInstallAnyway, onClose }: Props) {
  const [busy, setBusy] = useState(false);

  const replace = async () => {
    setBusy(true);
    try {
      await onReplace();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`${title} clashes with ${clash.with}`}
      wide
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <button className="btn btn-ghost modal-footer-start" onClick={onInstallAnyway} disabled={busy}>
            Install anyway
          </button>
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={replace} disabled={busy}>
            <PowerOff size={15} /> Turn off {clash.with} and install
          </button>
        </>
      }
    >
      <p className="modal-text">{clash.message.replace('{title}', title)}</p>
      <p className="modal-text">
        Turning {clash.with} off keeps its file, so you can switch back from the Content tab.
      </p>
    </Modal>
  );
}
