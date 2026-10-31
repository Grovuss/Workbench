import { useState } from 'react';
import Modal from '../Modal';
import { api, errorMessage } from '../../api';
import type { ExportItem, Profile } from '../../types';

const ITEMS: { id: ExportItem; label: string; hint: string; default: boolean }[] = [
  { id: 'config', label: 'Mod config', hint: 'config/', default: true },
  { id: 'options.txt', label: 'Game options', hint: 'options.txt', default: true },
  { id: 'resourcepacks', label: 'Resource packs', hint: 'resourcepacks/', default: true },
  { id: 'shaderpacks', label: 'Shader packs', hint: 'shaderpacks/', default: true },
  { id: 'saves', label: 'Worlds', hint: 'saves/ (can be large)', default: false },
];

interface Props {
  profile: Profile;
  onClose: () => void;
  onExported: (message: string) => void;
  onError: (message: string) => void;
}

export default function ExportModal({ profile, onClose, onExported, onError }: Props) {
  const [include, setInclude] = useState(() => new Set(ITEMS.filter((i) => i.default).map((i) => i.id)));
  const [busy, setBusy] = useState(false);

  const toggle = (id: ExportItem, on: boolean) =>
    setInclude((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const submit = async () => {
    setBusy(true);
    try {
      const path = await api.packs.export(profile.id, [...include]);
      if (path) {
        onExported(`Exported “${profile.name}” as a .workbench pack.`);
        onClose();
        return;
      }
    } catch (err) {
      onError(errorMessage(err));
    }
    setBusy(false);
  };

  return (
    <Modal
      title="Export as .workbench"
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? 'Exporting…' : 'Export'}
          </button>
        </>
      }
    >
      <p className="modal-text">
        Saves the version, loader, mods and memory settings. Modrinth mods are stored as links so the file stays
        small; other jars are bundled in. Java arguments are never exported.
      </p>
      <div className="export-items">
        {ITEMS.map((item) => (
          <label key={item.id} className="checkbox export-item">
            <input
              type="checkbox"
              checked={include.has(item.id)}
              disabled={busy}
              onChange={(e) => toggle(item.id, e.target.checked)}
            />
            <span>{item.label}</span>
            <code>{item.hint}</code>
          </label>
        ))}
      </div>
    </Modal>
  );
}
