import { useEffect, useMemo, useState } from 'react';
import { Check, Download, LoaderCircle } from 'lucide-react';
import Modal from '../Modal';
import ContentIcon from './ContentIcon';
import { api, errorMessage } from '../../api';
import { CONTENT } from '../../content';
import { LOADER_LABELS } from '../../loaders';
import type { ContentKind, ContentVersion, Loader, Profile } from '../../types';

/** Modrinth loaders a profile can use for a kind of content (the same rules the installer uses). */
function loadersFor(kind: ContentKind, loader: Loader): string[] | null {
  if (kind === 'resourcepack') return ['minecraft'];
  if (loader === 'vanilla') return null;
  if (kind === 'shader') return loader === 'forge' ? ['optifine'] : ['iris'];
  return loader === 'quilt' ? ['quilt', 'fabric'] : [loader];
}

interface Props {
  project: { projectId: string; title: string; iconUrl: string | null; kind: ContentKind };
  profiles: Profile[];
  onClose: () => void;
  onError: (message: string) => void;
}

/** Picks a profile to install into when browsing without one, showing which profiles the project has a version for. */
export default function InstallToModal({ project, profiles, onClose, onError }: Props) {
  const [versions, setVersions] = useState<ContentVersion[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());

  useEffect(() => {
    api.content
      .allVersions(project.projectId)
      .then(setVersions)
      .catch((err) => setFailed(errorMessage(err)));
  }, [project.projectId]);

  // Profiles that have a version, first; then the rest with why they don't.
  const rows = useMemo(() => {
    if (!versions) return [];
    return profiles
      .map((profile) => {
        const loaders = loadersFor(project.kind, profile.loader);
        let reason: string | null = null;
        if (!loaders) reason = project.kind === 'mod' ? 'Vanilla can’t use mods' : 'Needs a mod loader';
        else if (!versions.some((v) => v.gameVersions.includes(profile.mcVersion) && v.loaders.some((l) => loaders.includes(l)))) {
          reason = `No version for ${profile.loader === 'vanilla' ? '' : `${LOADER_LABELS[profile.loader]} `}${profile.mcVersion}`;
        }
        return { profile, reason };
      })
      .sort((a, b) => Number(Boolean(a.reason)) - Number(Boolean(b.reason)));
  }, [versions, profiles, project.kind]);

  const fitting = rows.filter((r) => !r.reason).length;

  const install = async (profile: Profile) => {
    setBusy(profile.id);
    try {
      await api.content.install({ profileId: profile.id, kind: project.kind }, project.projectId);
      setDone((s) => new Set(s).add(profile.id));
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      title="Install to…"
      onClose={busy ? () => {} : onClose}
      footer={
        <button className="btn btn-secondary" onClick={onClose} disabled={Boolean(busy)}>
          {done.size ? 'Done' : 'Cancel'}
        </button>
      }
    >
      <div className="modpack-head">
        <ContentIcon url={project.iconUrl} size={44} />
        <div>
          <strong>{project.title}</strong>
          <p>
            {!versions
              ? 'Checking which profiles it works on…'
              : fitting
                ? `Works on ${fitting} of your ${profiles.length === 1 ? 'profile' : `${profiles.length} profiles`}`
                : `No version for any of your profiles yet`}
          </p>
        </div>
      </div>

      {failed ? (
        <p className="form-error">{failed}</p>
      ) : !versions ? (
        <div className="mod-loading">
          <LoaderCircle size={22} className="spin" />
        </div>
      ) : profiles.length === 0 ? (
        <p className="mod-empty">Create a profile first, then install {CONTENT[project.kind].nounPlural} into it.</p>
      ) : (
        <ul className="install-to-list">
          {rows.map(({ profile, reason }) => (
            <li key={profile.id} className={reason ? 'install-to-row is-off' : 'install-to-row'}>
              <div className="install-to-info">
                <strong>{profile.name}</strong>
                <span>{reason ?? `${LOADER_LABELS[profile.loader]} ${profile.mcVersion}`}</span>
              </div>
              {done.has(profile.id) ? (
                <span className="mod-installed">
                  <Check size={15} /> Installed
                </span>
              ) : (
                !reason && (
                  <button className="btn btn-primary btn-sm" onClick={() => install(profile)} disabled={Boolean(busy)}>
                    {busy === profile.id ? <LoaderCircle size={15} className="spin" /> : <Download size={15} />}
                    {busy === profile.id ? 'Installing' : 'Install'}
                  </button>
                )
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
