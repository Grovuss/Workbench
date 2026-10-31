import { useEffect, useState } from 'react';
import { Puzzle } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import ContentBrowser from '../components/content/ContentBrowser';
import { api, errorMessage } from '../api';
import { CONTENT, contentBlockedReason } from '../content';
import { LOADER_LABELS } from '../loaders';
import type { ContentKind, InstalledContent, Profile } from '../types';

// Data packs belong to a world, so they're added from a profile's Worlds tab instead.
const KINDS: ContentKind[] = ['mod', 'resourcepack', 'shader'];

interface Props {
  profiles: Profile[] | null;
  onError: (message: string) => void;
}

/** Browse Modrinth and install into any profile that can use the content. */
export default function BrowsePage({ profiles, onError }: Props) {
  const [kind, setKind] = useState<ContentKind>('mod');
  const [profileId, setProfileId] = useState<string | null>(null);
  const [installed, setInstalled] = useState<InstalledContent[] | null>(null);
  const eligible = (profiles ?? []).filter((p) => !contentBlockedReason(kind, p.loader));
  const profile = eligible.find((p) => p.id === profileId) ?? eligible[0] ?? null;
  const labels = CONTENT[kind];

  useEffect(() => {
    if (!profile) return;
    setInstalled(null);
    api.content
      .list({ profileId: profile.id, kind })
      .then(setInstalled)
      .catch((err) => onError(errorMessage(err)));
  }, [profile?.id, kind, onError]);

  const picker = profile && (
    <label className="profile-picker">
      <span>Install into</span>
      <select className="input" value={profile.id} onChange={(e) => setProfileId(e.target.value)}>
        {eligible.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({LOADER_LABELS[p.loader]} {p.mcVersion})
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <>
      <PageHeader title="Browse" subtitle="Find mods, resource packs and shaders on Modrinth" actions={picker} />
      <div className="segmented browse-kinds" role="group" aria-label="Content type">
        {KINDS.map((k) => (
          <button key={k} aria-pressed={kind === k} onClick={() => setKind(k)}>
            {CONTENT[k].title}
          </button>
        ))}
      </div>
      {profiles && !profile && (
        <div className="empty">
          <Puzzle className="empty-icon" size={48} strokeWidth={1.5} />
          <h2>No profiles can use {labels.nounPlural}</h2>
          <p>
            {kind === 'shader'
              ? 'Create a Fabric, Quilt or NeoForge profile to use shaders.'
              : kind === 'mod'
                ? 'Create a Fabric, Quilt, Forge or NeoForge profile to start adding mods.'
                : 'Create a profile to start adding resource packs.'}
          </p>
        </div>
      )}
      {profile && installed && (
        <ContentBrowser
          key={`${profile.id}-${kind}`}
          profile={profile}
          target={{ profileId: profile.id, kind }}
          installed={installed}
          onInstalled={setInstalled}
          onError={onError}
        />
      )}
    </>
  );
}
