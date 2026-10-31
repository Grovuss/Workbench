import { useEffect, useState } from 'react';
import { Puzzle } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import ModBrowser from '../components/mods/ModBrowser';
import { api, errorMessage } from '../api';
import { LOADER_LABELS } from '../loaders';
import type { InstalledMod, Profile } from '../types';

interface Props {
  profiles: Profile[] | null;
  onError: (message: string) => void;
}

/** Browse Modrinth and install into any modded profile. */
export default function ModsPage({ profiles, onError }: Props) {
  const modded = (profiles ?? []).filter((p) => p.loader !== 'vanilla');
  const [profileId, setProfileId] = useState<string | null>(null);
  const [installed, setInstalled] = useState<InstalledMod[] | null>(null);
  const profile = modded.find((p) => p.id === profileId) ?? modded[0] ?? null;

  useEffect(() => {
    if (!profile) return;
    setInstalled(null);
    api.mods
      .list(profile.id)
      .then(setInstalled)
      .catch((err) => onError(errorMessage(err)));
  }, [profile?.id, onError]);

  const picker = profile && (
    <label className="profile-picker">
      <span>Install into</span>
      <select className="input" value={profile.id} onChange={(e) => setProfileId(e.target.value)}>
        {modded.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({LOADER_LABELS[p.loader]} {p.mcVersion})
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <>
      <PageHeader title="Mods" subtitle="Find mods on Modrinth for your profiles" actions={picker} />
      {profiles && !profile && (
        <div className="empty">
          <Puzzle className="empty-icon" size={48} strokeWidth={1.5} />
          <h2>No modded profiles</h2>
          <p>Create a Fabric, Quilt, Forge or NeoForge profile to start adding mods.</p>
        </div>
      )}
      {profile && installed && (
        <ModBrowser key={profile.id} profile={profile} installed={installed} onInstalled={setInstalled} onError={onError} />
      )}
    </>
  );
}
