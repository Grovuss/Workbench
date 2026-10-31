import { useEffect, useMemo, useState } from 'react';
import { Package, Puzzle } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import ContentBrowser, { type BrowseKind } from '../components/content/ContentBrowser';
import ModpackBrowser from '../components/content/ModpackBrowser';
import { api, errorMessage } from '../api';
import { CONTENT, contentBlockedReason } from '../content';
import { LOADER_LABELS } from '../loaders';
import type { ContentKind, InstalledContent, Profile } from '../types';

// Data packs belong to a world, so they're added from a profile's Worlds tab instead.
const KINDS: ContentKind[] = ['mod', 'resourcepack', 'shader'];
const KIND_OPTIONS: BrowseKind[] = ['all', ...KINDS];

interface Props {
  profiles: Profile[] | null;
  /** A modpack was installed as a new profile. */
  onProfileCreated: (profile: Profile) => void;
  onError: (message: string) => void;
}

/** Browse Modrinth: content to install into a profile, or modpacks that become new profiles. */
export default function BrowsePage({ profiles, onProfileCreated, onError }: Props) {
  const [section, setSection] = useState<'content' | 'modpacks'>('content');
  const [kind, setKind] = useState<BrowseKind>('all');
  const [profileId, setProfileId] = useState<string | null>(null);
  const [lists, setLists] = useState<Partial<Record<ContentKind, InstalledContent[]>> | null>(null);
  // Every profile can use resource packs, so "All" works anywhere.
  const eligible = (profiles ?? []).filter((p) => kind === 'all' || !contentBlockedReason(kind, p.loader));
  const profile = eligible.find((p) => p.id === profileId) ?? eligible[0] ?? null;

  useEffect(() => {
    if (!profile) return;
    setLists(null);
    const usable = KINDS.filter((k) => !contentBlockedReason(k, profile.loader));
    Promise.all(usable.map((k) => api.content.list({ profileId: profile.id, kind: k }).then((items) => [k, items] as const)))
      .then((entries) => setLists(Object.fromEntries(entries)))
      .catch((err) => onError(errorMessage(err)));
  }, [profile?.id, profile?.loader, onError]);

  const installedIds = useMemo(
    () =>
      new Set(
        Object.values(lists ?? {})
          .flat()
          .map((item) => item!.projectId)
          .filter((id): id is string => Boolean(id)),
      ),
    [lists],
  );

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
      <PageHeader
        title="Browse"
        subtitle={section === 'content' ? 'Find mods, resource packs and shaders on Modrinth' : 'Install a Modrinth modpack as a new profile'}
        actions={section === 'content' ? picker : null}
      />
      <div className="segmented browse-switch" role="group" aria-label="What to browse">
        <button aria-pressed={section === 'content'} onClick={() => setSection('content')}>
          <Puzzle size={14} /> Content
        </button>
        <button aria-pressed={section === 'modpacks'} onClick={() => setSection('modpacks')}>
          <Package size={14} /> Modpacks
        </button>
      </div>
      {section === 'modpacks' && <ModpackBrowser onInstalled={onProfileCreated} onError={onError} />}
      {section === 'content' && profiles && !profile && (
        <div className="empty">
          <Puzzle className="empty-icon" size={48} strokeWidth={1.5} />
          <h2>{kind === 'all' ? 'No profiles yet' : `No profiles can use ${CONTENT[kind].nounPlural}`}</h2>
          <p>
            {kind === 'shader'
              ? 'Create a Fabric, Quilt or NeoForge profile to use shaders.'
              : kind === 'mod'
                ? 'Create a Fabric, Quilt, Forge or NeoForge profile to start adding mods.'
                : 'Create a profile to start adding content.'}
          </p>
          {kind !== 'all' && (
            <button className="btn btn-secondary" onClick={() => setKind('all')}>
              Show all content
            </button>
          )}
        </div>
      )}
      {section === 'content' && profile && lists && (
        <ContentBrowser
          key={profile.id}
          profile={profile}
          kind={kind}
          kindOptions={KIND_OPTIONS}
          onKindChange={setKind}
          installedIds={installedIds}
          onInstalled={(k, items) => setLists((l) => ({ ...l, [k]: items }))}
          onError={onError}
        />
      )}
    </>
  );
}
