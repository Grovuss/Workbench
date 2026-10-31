import { useState, type FormEvent } from 'react';
import { Trash2 } from 'lucide-react';
import { api, errorMessage } from '../../api';
import type { Profile } from '../../types';

interface Props {
  profile: Profile;
  busy: boolean;
  onRenamed: (profile: Profile) => void;
  onDelete: () => void;
  onError: (message: string) => void;
}

export default function ProfileSettingsTab({ profile, busy, onRenamed, onDelete, onError }: Props) {
  const [name, setName] = useState(profile.name);
  const [saving, setSaving] = useState(false);
  const dirty = name.trim() !== profile.name && name.trim() !== '';

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!dirty) return;
    setSaving(true);
    try {
      const updated = await api.profiles.rename(profile.id, name);
      onRenamed(updated);
      setName(updated.name);
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <h2 className="section-label section-label-first">General</h2>
      <div className="settings-group">
        <form className="settings-row" onSubmit={save}>
          <div>
            <h3>Name</h3>
            <p>Shown in your profile list.</p>
          </div>
          <div className="inline-field">
            <input
              className="input"
              value={name}
              maxLength={48}
              onChange={(e) => setName(e.target.value)}
              aria-label="Profile name"
            />
            <button type="submit" className="btn btn-secondary" disabled={!dirty || saving}>
              Save
            </button>
          </div>
        </form>
        <div className="settings-row">
          <div>
            <h3>Version</h3>
            <p>Vanilla {profile.mcVersion}. Changing versions comes with mod loader support.</p>
          </div>
        </div>
      </div>

      <h2 className="section-label">Danger zone</h2>
      <div className="settings-group">
        <div className="settings-row">
          <div>
            <h3>Delete profile</h3>
            <p>{busy ? 'Stop the game before deleting.' : 'Removes the profile and all of its worlds.'}</p>
          </div>
          <button className="btn btn-danger-fill" onClick={onDelete} disabled={busy}>
            <Trash2 size={15} /> Delete
          </button>
        </div>
      </div>
    </>
  );
}
