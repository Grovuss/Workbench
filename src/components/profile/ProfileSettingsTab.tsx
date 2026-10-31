import { useEffect, useState, type FormEvent } from 'react';
import { Copy, ImagePlus, Trash2 } from 'lucide-react';
import ProfileIcon from '../ProfileIcon';
import Toggle from '../Toggle';
import { DEFAULT_RESOLUTION, MemorySlider, ResolutionFields } from '../GameControls';
import VersionPicker, { isCompleteSelection } from '../VersionPicker';
import { api, errorMessage } from '../../api';
import { formatGb, maxMemoryMb } from '../../format';
import type { Profile, ProfileSettings, Settings, VersionSelection } from '../../types';

interface Props {
  profile: Profile;
  busy: boolean;
  onUpdated: (profile: Profile) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onError: (message: string) => void;
}

export default function ProfileSettingsTab({ profile, busy, onUpdated, onDelete, onDuplicate, onError }: Props) {
  return (
    <>
      <h2 className="section-label section-label-first">General</h2>
      <div className="settings-group">
        <NameSection profile={profile} onUpdated={onUpdated} onError={onError} />
        <IconSection profile={profile} onUpdated={onUpdated} onError={onError} />
        <div className="settings-row">
          <div>
            <h3>Duplicate</h3>
            <p>{busy ? 'Stop the game before duplicating.' : 'A copy with the same mods, worlds and settings, to try changes safely.'}</p>
          </div>
          <button className="btn btn-secondary" onClick={onDuplicate} disabled={busy}>
            <Copy size={15} /> Duplicate
          </button>
        </div>
      </div>

      <h2 className="section-label">Version</h2>
      <VersionSection profile={profile} busy={busy} onUpdated={onUpdated} onError={onError} />

      <h2 className="section-label">Game</h2>
      <GameSection profile={profile} onUpdated={onUpdated} onError={onError} />

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

type SectionProps = Pick<Props, 'profile' | 'onUpdated' | 'onError'>;

function IconSection({ profile, onUpdated, onError }: SectionProps) {
  const apply = (pending: Promise<Profile | null>) =>
    pending.then((p) => p && onUpdated(p)).catch((err) => onError(errorMessage(err)));

  return (
    <div className="settings-row">
      <div className="settings-row-media">
        <ProfileIcon profile={profile} className="profile-icon" />
        <div>
          <h3>Icon</h3>
          <p>PNG, JPEG, WebP or GIF. Included when you export a .workbench pack.</p>
        </div>
      </div>
      <div className="icon-actions">
        {profile.icon && (
          <button className="btn btn-ghost" onClick={() => apply(api.profiles.removeIcon(profile.id))}>
            Remove
          </button>
        )}
        <button className="btn btn-secondary" onClick={() => apply(api.profiles.setIcon(profile.id))}>
          <ImagePlus size={15} /> {profile.icon ? 'Change' : 'Choose image'}
        </button>
      </div>
    </div>
  );
}

function NameSection({ profile, onUpdated, onError }: SectionProps) {
  const [name, setName] = useState(profile.name);
  const [saving, setSaving] = useState(false);
  const dirty = name.trim() !== profile.name && name.trim() !== '';

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!dirty) return;
    setSaving(true);
    try {
      const updated = await api.profiles.rename(profile.id, name);
      onUpdated(updated);
      setName(updated.name);
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
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
  );
}

const sameSelection = (a: VersionSelection, b: VersionSelection) =>
  a.mcVersion === b.mcVersion && a.loader === b.loader && a.loaderVersion === b.loaderVersion;

function VersionSection({ profile, busy, onUpdated, onError }: SectionProps & { busy: boolean }) {
  const current: VersionSelection = {
    mcVersion: profile.mcVersion,
    loader: profile.loader,
    loaderVersion: profile.loaderVersion,
  };
  const [selection, setSelection] = useState(current);
  const [saving, setSaving] = useState(false);
  const changed = !sameSelection(selection, current);

  const apply = async () => {
    setSaving(true);
    try {
      onUpdated(await api.profiles.setVersion(profile.id, selection));
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-group settings-block">
      <VersionPicker initial={current} onChange={setSelection} />
      <div className="settings-block-footer">
        <p>
          {busy
            ? 'Stop the game before changing its version.'
            : 'Worlds opened in a newer version may not load in an older one. Back them up first.'}
        </p>
        <button
          className="btn btn-primary btn-compact"
          onClick={apply}
          disabled={!changed || !isCompleteSelection(selection) || busy || saving}
        >
          {saving ? 'Applying…' : 'Apply'}
        </button>
      </div>
    </div>
  );
}

const FULLSCREEN_CHOICES: { label: string; value: boolean | null }[] = [
  { label: 'Default', value: null },
  { label: 'Windowed', value: false },
  { label: 'Fullscreen', value: true },
];

function GameSection({ profile, onUpdated, onError }: SectionProps) {
  const [draft, setDraft] = useState<ProfileSettings>(profile.settings);
  const [global, setGlobal] = useState<Settings | null>(null);
  const [totalMemory, setTotalMemory] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(profile.settings);

  useEffect(() => {
    Promise.all([api.settings.get(), api.system.info()])
      .then(([s, info]) => {
        setGlobal(s);
        setTotalMemory(info.totalMemoryMb);
      })
      .catch((err) => onError(errorMessage(err)));
  }, [onError]);

  const set = (patch: Partial<ProfileSettings>) => setDraft((d) => ({ ...d, ...patch }));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const updated = await api.profiles.updateSettings(profile.id, draft);
      onUpdated(updated);
      setDraft(updated.settings);
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const maxMemory = totalMemory ? maxMemoryMb(totalMemory) : 8192;
  const resolution = draft.resolution;
  const globalMemory = global?.memoryMb ?? null;
  const customCommands = draft.preLaunchCommand !== null || draft.postExitCommand !== null;

  return (
    <form className="settings-group" onSubmit={save}>
      <div className="settings-row">
        <div>
          <h3>Memory</h3>
          <p>
            {draft.memoryMb === null
              ? `Using the global setting${globalMemory ? ` (${formatGb(globalMemory)})` : ''}.`
              : 'Custom amount for this profile. Modpacks usually want 6–8 GB.'}
          </p>
        </div>
        <div className="memory-control">
          {draft.memoryMb !== null && <MemorySlider value={draft.memoryMb} max={maxMemory} onChange={(memoryMb) => set({ memoryMb })} />}
          <Toggle
            label="Custom memory"
            checked={draft.memoryMb !== null}
            onChange={(on) => set({ memoryMb: on ? (globalMemory ?? 4096) : null })}
          />
        </div>
      </div>

      <div className="settings-row">
        <div>
          <h3>Java arguments</h3>
          <p>Extra JVM flags, separated by spaces.</p>
        </div>
        <input
          className="input input-mono inline-field"
          value={draft.jvmArgs}
          placeholder="-XX:+UseG1GC"
          spellCheck={false}
          onChange={(e) => set({ jvmArgs: e.target.value })}
          aria-label="Java arguments"
        />
      </div>

      <div className="settings-row">
        <div>
          <h3>Window size</h3>
          <p>{resolution ? 'Game window size when it opens.' : 'Uses the default from Settings.'}</p>
        </div>
        <div className="memory-control">
          {resolution && <ResolutionFields value={resolution} onChange={(next) => set({ resolution: next })} />}
          <Toggle
            label="Custom window size"
            checked={resolution !== null}
            onChange={(on) => set({ resolution: on ? DEFAULT_RESOLUTION : null })}
          />
        </div>
      </div>

      <div className="settings-row">
        <div>
          <h3>Fullscreen</h3>
          <p>
            {draft.fullscreen === null
              ? `Using the global setting${global ? ` (${global.fullscreen ? 'fullscreen' : 'windowed'})` : ''}.`
              : 'How this profile opens. F11 switches in game.'}
          </p>
        </div>
        <div className="segmented" role="group" aria-label="Fullscreen">
          {FULLSCREEN_CHOICES.map((choice) => (
            <button
              type="button"
              key={choice.label}
              aria-pressed={draft.fullscreen === choice.value}
              onClick={() => set({ fullscreen: choice.value })}
            >
              {choice.label}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-row">
        <div>
          <h3>Launch commands</h3>
          <p>
            {customCommands
              ? 'Used instead of the ones in Settings. Leave a box empty to run nothing.'
              : 'Using the commands from Settings, if any.'}
          </p>
        </div>
        <Toggle
          label="Custom launch commands"
          checked={customCommands}
          onChange={(on) =>
            set(
              on
                ? { preLaunchCommand: global?.preLaunchCommand ?? '', postExitCommand: global?.postExitCommand ?? '' }
                : { preLaunchCommand: null, postExitCommand: null },
            )
          }
        />
      </div>
      {customCommands && (
        <>
          <div className="settings-row">
            <div>
              <h3>Before launch</h3>
              <p>Runs in the profile’s folder; the game waits for it.</p>
            </div>
            <input
              className="input input-mono inline-field"
              value={draft.preLaunchCommand ?? ''}
              spellCheck={false}
              onChange={(e) => set({ preLaunchCommand: e.target.value })}
              aria-label="Before launch command"
            />
          </div>
          <div className="settings-row">
            <div>
              <h3>After the game closes</h3>
              <p>Runs in the profile’s folder once the game has exited.</p>
            </div>
            <input
              className="input input-mono inline-field"
              value={draft.postExitCommand ?? ''}
              spellCheck={false}
              onChange={(e) => set({ postExitCommand: e.target.value })}
              aria-label="After the game closes command"
            />
          </div>
        </>
      )}

      {dirty && (
        <div className="settings-row settings-save-row">
          <p>Applies the next time you launch.</p>
          <div className="toolbar-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setDraft(profile.settings)}>
              Discard
            </button>
            <button type="submit" className="btn btn-primary btn-compact" disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
