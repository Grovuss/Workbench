import { useEffect, useState } from 'react';
import { ArrowUpCircle, Check, Copy, LoaderCircle, PackageOpen, Server } from 'lucide-react';
import Markdown from '../Markdown';
import Modal from '../Modal';
import JobProgress, { useJobProgress } from '../JobProgress';
import { api, errorMessage } from '../../api';
import { timeAgo } from '../../time';
import type { ModpackUpdate, Profile } from '../../types';

// ---------- Share code ----------

export function ShareCodeModal({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const [result, setResult] = useState<{ code: string; included: number; skipped: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.share
      .create(profile.id)
      .then(setResult)
      .catch((err) => setError(errorMessage(err)));
  }, [profile.id]);

  const copy = () => {
    if (!result) return;
    navigator.clipboard.writeText(result.code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <Modal
      title="Share code"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Done
          </button>
          <button className="btn btn-primary" onClick={copy} disabled={!result}>
            {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copied' : 'Copy code'}
          </button>
        </>
      }
    >
      <p className="modal-text">
        Send this to a friend. In Workbench they go to Create profile → Import pack → Share code, and get the same Minecraft
        version, loader and exact versions of your mods, resource packs and shaders.
      </p>
      {result ? (
        <>
          <textarea className="input share-code" readOnly value={result.code} onFocus={(e) => e.currentTarget.select()} rows={4} />
          <p className="content-hint">
            {result.included} {result.included === 1 ? 'file' : 'files'} from Modrinth. Config isn’t included; export a .workbench file to
            share that too.
          </p>
          {result.skipped.length > 0 && (
            <p className="content-hint share-skipped">
              Not on Modrinth, so left out: {result.skipped.join(', ')}.
            </p>
          )}
        </>
      ) : (
        !error && (
          <div className="mod-loading">
            <LoaderCircle size={22} className="spin" />
          </div>
        )
      )}
      {error && <p className="form-error">{error}</p>}
    </Modal>
  );
}

// ---------- Server pack ----------

export function ServerPackModal({
  profile,
  onClose,
  onSuccess,
}: {
  profile: Profile;
  onClose: () => void;
  onSuccess: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress] = useJobProgress();

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.serverPack.export(profile.id);
      if (!result) return setBusy(false);
      const left = result.clientOnly.length;
      onSuccess(
        `Server pack ready with ${result.modCount} ${result.modCount === 1 ? 'mod' : 'mods'}.` +
          (left ? ` Left out ${left} that only run in the game client.` : ''),
      );
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Export server pack"
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={start} disabled={busy}>
            <Server size={16} /> Choose where to save it
          </button>
        </>
      }
    >
      {busy ? (
        <JobProgress progress={progress} label="Exporting server pack" />
      ) : (
        <>
          <p className="modal-text">
            Makes a folder you can run as a server for this profile: the mods that work on servers, config, the{' '}
            {profile.loader === 'neoforge' ? 'NeoForge' : profile.loader === 'forge' ? 'Forge' : profile.loader === 'quilt' ? 'Quilt' : 'Fabric'}{' '}
            server, and start scripts for Windows, Mac and Linux.
          </p>
          <p className="content-hint">Mods that only run in the game client, like Sodium and Mod Menu, are left out. The folder’s README explains the rest.</p>
        </>
      )}
      {error && <p className="form-error">{error}</p>}
    </Modal>
  );
}

// ---------- Modpack updates ----------

/** A notice under the profile header when the modpack it came from has a newer version. */
export function ModpackUpdateBanner({
  profile,
  busy,
  onUpdated,
  onSuccess,
}: {
  profile: Profile;
  /** The game is starting or running. */
  busy: boolean;
  onUpdated: (profile: Profile) => void;
  onSuccess: (message: string) => void;
}) {
  const [update, setUpdate] = useState<ModpackUpdate | null>(null);
  const [open, setOpen] = useState(false);
  const versionId = profile.pack?.versionId;

  useEffect(() => {
    setUpdate(null);
    if (!versionId) return;
    let current = true;
    api.modpacks
      .checkUpdate(profile.id)
      .then((u) => current && setUpdate(u))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [profile.id, versionId]);

  if (!profile.pack || !update?.latest) return null;
  const latest = update.latest;

  return (
    <>
      <div className="content-notice pack-update">
        <ArrowUpCircle size={18} />
        <p>
          <strong>
            {profile.pack.title} {latest.versionNumber}
          </strong>{' '}
          is out. You have {update.current.versionNumber}.
        </p>
        <button className="btn btn-primary btn-play" onClick={() => setOpen(true)} disabled={busy} title={busy ? 'Close the game to update' : undefined}>
          See what’s new
        </button>
      </div>
      {open && (
        <ModpackUpdateModal
          profile={profile}
          update={update}
          onClose={() => setOpen(false)}
          onUpdated={(p, kept) => {
            onUpdated(p);
            setUpdate({ ...update, latest: null });
            onSuccess(
              `Updated ${profile.pack!.title} to ${latest.versionNumber}.` +
                (kept.length ? ` Kept your changes to ${kept.length} config ${kept.length === 1 ? 'file' : 'files'}.` : ''),
            );
          }}
        />
      )}
    </>
  );
}

function ModpackUpdateModal({
  profile,
  update,
  onClose,
  onUpdated,
}: {
  profile: Profile;
  update: ModpackUpdate;
  onClose: () => void;
  onUpdated: (profile: Profile, kept: string[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress] = useJobProgress();
  const latest = update.latest!;

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const { profile: updated, kept } = await api.modpacks.update(profile.id, latest.versionId);
      onUpdated(updated, kept);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Update ${profile.pack?.title}`}
      wide
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Not now
          </button>
          <button className="btn btn-primary" onClick={start} disabled={busy}>
            {busy ? <LoaderCircle size={16} className="spin" /> : <PackageOpen size={16} />} Update to {latest.versionNumber}
          </button>
        </>
      }
    >
      {busy ? (
        <JobProgress progress={progress} label="Updating modpack" />
      ) : (
        <>
          <p className="modal-text">
            {update.current.versionNumber} → <strong>{latest.versionNumber}</strong> · released {timeAgo(latest.date)}
            {latest.newerCount > 1 && ` · includes ${latest.newerCount - 1} earlier ${latest.newerCount === 2 ? 'update' : 'updates'}`}
          </p>
          <ul className="pack-update-points">
            <li>Your worlds are backed up first.</li>
            <li>Mods you added, disabled or removed stay that way.</li>
            <li>Config you changed is kept; the rest follows the pack.</li>
          </ul>
          <div className="changelog">
            {latest.changelog.trim() ? <Markdown text={latest.changelog} /> : <p className="changelog-none">No changelog for this version.</p>}
          </div>
        </>
      )}
      {error && <p className="form-error">{error}</p>}
    </Modal>
  );
}
