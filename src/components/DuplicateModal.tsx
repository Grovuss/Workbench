import { useState, type FormEvent } from 'react';
import Modal from './Modal';
import VersionPicker from './VersionPicker';
import { api, errorMessage } from '../api';
import { CONTENT } from '../content';
import { LOADER_LABELS } from '../loaders';
import type { DuplicateResult, PortMissing, Profile, VersionSelection } from '../types';

interface Props {
  profile: Profile;
  onClose: () => void;
  onDuplicated: (profile: Profile) => void;
  onError: (message: string) => void;
}

const sameVersion = (a: VersionSelection, b: VersionSelection) =>
  a.mcVersion === b.mcVersion && a.loader === b.loader && a.loaderVersion === b.loaderVersion;

// A copy's name without an earlier "(copy)" or "(1.21.1)", so copies of copies don't pile those up.
const baseName = (name: string) => name.replace(/ \((?:copy|\d[\w.-]*)\)$/i, '');

const versionLabel = (v: VersionSelection) => (v.loader === 'vanilla' ? `Minecraft ${v.mcVersion}` : `${LOADER_LABELS[v.loader]} ${v.mcVersion}`);

/** Copies a profile, optionally to another Minecraft version, moving its mods over to that version. */
export default function DuplicateModal({ profile, onClose, onDuplicated, onError }: Props) {
  const current: VersionSelection = { mcVersion: profile.mcVersion, loader: profile.loader, loaderVersion: profile.loaderVersion };
  const [name, setName] = useState(`${baseName(profile.name)} (copy)`.slice(0, 48));
  const [nameEdited, setNameEdited] = useState(false);
  const [otherVersion, setOtherVersion] = useState(false);
  const [selection, setSelection] = useState<VersionSelection>(current);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DuplicateResult | null>(null);

  const target = otherVersion ? selection : current;
  const changing = !sameVersion(target, current);
  const ready = name.trim() && (!otherVersion || (selection.mcVersion && (selection.loader === 'vanilla' || selection.loaderVersion)));

  const pick = (next: VersionSelection) => {
    setSelection(next);
    // Until a name is typed, it follows the version.
    if (!nameEdited) setName(`${baseName(profile.name)} (${sameVersion(next, current) ? 'copy' : next.mcVersion})`.slice(0, 48));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const done = await api.profiles.duplicate(profile.id, name, changing ? target : undefined);
      const port = done.port;
      if (port && ('error' in port || port.missing.length)) {
        setResult(done);
        setBusy(false);
      } else {
        onDuplicated(done.profile);
      }
    } catch (err) {
      onError(errorMessage(err));
      setBusy(false);
    }
  };

  if (result) return <PortResult result={result} from={current} onOpen={() => onDuplicated(result.profile)} />;

  return (
    <Modal
      title="Duplicate profile"
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="duplicate-profile" className="btn btn-primary" disabled={busy || !ready}>
            {busy ? (changing ? 'Copying and moving mods…' : 'Copying…') : 'Duplicate'}
          </button>
        </>
      }
    >
      <form id="duplicate-profile" className="form" onSubmit={submit}>
        <p className="modal-text">
          Copies everything: mods, worlds, config and settings. Playtime starts from zero.
          {changing && ' Mods, resource packs and shaders are swapped for their versions for the new one.'}
        </p>
        <label className="field">
          <span className="field-label">Name</span>
          <input
            className="input"
            value={name}
            maxLength={48}
            onChange={(e) => {
              setName(e.target.value);
              setNameEdited(true);
            }}
            autoFocus
          />
        </label>
        <div className="field">
          <span className="field-label">Version</span>
          <div className="segmented segmented-full duplicate-version-switch" role="group" aria-label="Version of the copy">
            <button type="button" aria-pressed={!otherVersion} disabled={busy} onClick={() => setOtherVersion(false)}>
              Same ({versionLabel(current)})
            </button>
            <button type="button" aria-pressed={otherVersion} disabled={busy} onClick={() => setOtherVersion(true)}>
              Another version
            </button>
          </div>
        </div>
        {otherVersion && (
          <fieldset className="duplicate-picker" disabled={busy}>
            <VersionPicker initial={current} onChange={pick} />
          </fieldset>
        )}
      </form>
    </Modal>
  );
}

const GROUPS: { id: string; title: string; match: (m: PortMissing) => boolean }[] = [
  { id: 'no-version-mod', title: 'Turned off for now: no version for {v} yet. They come back on by themselves once there is.', match: (m) => m.kind === 'mod' && m.reason === 'no-version' },
  { id: 'unknown', title: 'Turned off: not from Modrinth, so they couldn’t be checked', match: (m) => m.reason === 'unknown' },
  { id: 'loader', title: 'Turned off: vanilla Minecraft can’t run mods or shaders', match: (m) => m.reason === 'loader' },
  {
    id: 'no-version-pack',
    title: 'Kept as they were: no version for {v} yet, but older packs usually still work. They update by themselves once there is.',
    match: (m) => m.kind !== 'mod' && m.reason === 'no-version',
  },
];

function PortResult({ result, from, onOpen }: { result: DuplicateResult; from: VersionSelection; onOpen: () => void }) {
  const { profile, port } = result;
  const to = versionLabel(profile);
  return (
    <Modal
      title={`Copied to ${to}`}
      onClose={onOpen}
      footer={
        <button className="btn btn-primary" onClick={onOpen}>
          Open profile
        </button>
      }
    >
      {port && 'error' in port ? (
        <p className="modal-text">
          The copy was made, but its mods couldn’t be moved over: {port.error} They’re still the ones for {versionLabel(from)}, so update them
          from the copy’s Mods tab before playing.
        </p>
      ) : (
        port && (
          <>
            <p className="modal-text">
              {port.moved === 0
                ? 'Nothing else needed changing.'
                : `Moved ${port.moved} over to ${port.moved === 1 ? 'its' : 'their'} ${profile.mcVersion} ${port.moved === 1 ? 'version' : 'versions'}.`}{' '}
              {port.missing.length === 1 ? 'One isn’t' : `${port.missing.length} aren’t`} available for {profile.mcVersion}:
            </p>
            <div className="port-missing">
              {GROUPS.map((g) => {
                const items = port.missing.filter(g.match);
                if (!items.length) return null;
                return (
                  <section key={g.id}>
                    <h3>{g.title.replace('{v}', profile.mcVersion)}</h3>
                    <ul>
                      {items.map((m) => (
                        <li key={`${m.kind}:${m.title}`}>
                          <span>{m.title}</span>
                          <small>{CONTENT[m.kind].noun}</small>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          </>
        )
      )}
    </Modal>
  );
}
