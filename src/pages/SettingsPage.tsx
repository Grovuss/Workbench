import { useEffect, useRef, useState } from 'react';
import {
  Check,
  ClipboardCopy,
  Download,
  Coffee,
  FolderOpen,
  Gamepad2,
  Globe,
  HardDrive,
  LifeBuoy,
  Palette,
  RefreshCw,
  Rocket,
  RotateCcw,
  Users,
} from 'lucide-react';
import PageHeader from '../components/PageHeader';
import Toggle from '../components/Toggle';
import Modal from '../components/Modal';
import { DEFAULT_RESOLUTION, MemorySlider, ResolutionFields, validResolution } from '../components/GameControls';
import { api, errorMessage } from '../api';
import { formatBytes, formatGb, maxMemoryMb } from '../format';
import { reduceMotionStored, setReduceMotion } from '../motion';
import AppearanceSection from '../components/AppearanceSection';
import { Row, Section } from '../components/SettingsRows';
import { APPEARANCE_DEFAULTS, type Appearance } from '../appearance';
import { useUpdateStatus } from '../useUpdateStatus';
import type { LauncherOnLaunch, Resolution, Settings, StorageUsage, SystemInfo, UpdateStatus } from '../types';

const ON_LAUNCH: { id: LauncherOnLaunch; label: string }[] = [
  { id: 'keep', label: 'Stay open' },
  { id: 'minimize', label: 'Minimize' },
  { id: 'hide', label: 'Hide' },
];

const DOWNLOAD_THREADS = [4, 8, 16, 32];

const SECTIONS = [
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'launching', label: 'Launching', icon: Rocket },
  { id: 'game', label: 'Game defaults', icon: Gamepad2 },
  { id: 'worlds', label: 'Worlds', icon: Globe },
  { id: 'discord', label: 'Discord', icon: Users },
  { id: 'storage', label: 'Storage', icon: HardDrive },
  { id: 'help', label: 'Updates & help', icon: LifeBuoy },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

// Typing in a text field saves once it pauses for this long.
const TEXT_SAVE_MS = 500;

interface Props {
  appearance: Appearance;
  onAppearanceChange: (patch: Partial<Appearance>) => void;
  onError: (message: string) => void;
}

export default function SettingsPage({ appearance, onAppearanceChange, onError }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [resets, setResets] = useState(0);
  const [active, setActive] = useState<SectionId>('appearance');
  const timers = useRef<Record<string, number>>({});

  useEffect(() => {
    Promise.all([api.settings.get(), api.system.info()])
      .then(([s, info]) => {
        setSettings(s);
        setSystem(info);
      })
      .catch((err) => onError(errorMessage(err)));
  }, [onError]);

  // Highlights the section being read in the side index.
  useEffect(() => {
    if (!settings) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id.replace('settings-', '') as SectionId);
      },
      { rootMargin: '0px 0px -65% 0px' },
    );
    for (const s of SECTIONS) {
      const el = document.getElementById(`settings-${s.id}`);
      if (el) observer.observe(el);
    }
    // The last section is too short to reach the top, so the bottom of the page counts as it.
    const main = document.querySelector('.main');
    const onScroll = () => {
      if (main && main.scrollTop + main.clientHeight >= main.scrollHeight - 4) setActive(SECTIONS[SECTIONS.length - 1].id);
    };
    main?.addEventListener('scroll', onScroll);
    return () => {
      observer.disconnect();
      main?.removeEventListener('scroll', onScroll);
    };
  }, [settings]);

  /** Shows the change straight away and saves it, after a pause for text that's still being typed. Half-typed numbers aren't saved. */
  const update = (patch: Partial<Settings>, delay = 0, valid = true) => {
    setSettings((s) => s && { ...s, ...patch });
    const key = Object.keys(patch).join(',');
    window.clearTimeout(timers.current[key]);
    if (!valid) return;
    timers.current[key] = window.setTimeout(() => {
      api.settings.set(patch).catch((err) => onError(errorMessage(err)));
    }, delay);
  };

  const jumpTo = (id: SectionId) => {
    setActive(id);
    document.getElementById(`settings-${id}`)?.scrollIntoView({ behavior: reduceMotionStored() ? 'auto' : 'smooth', block: 'start' });
  };

  if (!settings || !system) return <PageHeader title="Settings" subtitle="Customize how Workbench looks and behaves" />;

  const maxMemory = maxMemoryMb(system.totalMemoryMb);
  const resolution = settings.resolution;
  const setSize = (size: Resolution) => update({ resolution: size }, TEXT_SAVE_MS, validResolution(size));

  return (
    <>
      <PageHeader title="Settings" subtitle="Customize how Workbench looks and behaves" />

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button key={id} className="settings-nav-item" aria-current={active === id || undefined} onClick={() => jumpTo(id)}>
              <Icon size={16} /> {label}
            </button>
          ))}
        </nav>

        <div className="settings-sections">
          <AppearanceSection key={resets} appearance={appearance} onChange={onAppearanceChange} onError={onError} />

          <Section id="launching" title="Launching">
            <Row
              title="Check mods before launching"
              description="Looks for missing dependencies, wrong versions and mods known not to work together, and asks before starting the game if it finds any."
            >
              <Toggle label="Check mods before launching" checked={settings.checkModsOnLaunch} onChange={(on) => update({ checkModsOnLaunch: on })} />
            </Row>
            <Row
              title="While you play"
              description={
                settings.onLaunch === 'hide'
                  ? 'Workbench hides while the game runs, and comes back when it closes.'
                  : settings.onLaunch === 'minimize'
                    ? 'Workbench minimizes while the game runs, and comes back when it closes.'
                    : 'Workbench stays open next to the game.'
              }
            >
              <div className="segmented" role="group" aria-label="While you play">
                {ON_LAUNCH.map(({ id, label }) => (
                  <button key={id} aria-pressed={settings.onLaunch === id} onClick={() => update({ onLaunch: id })}>
                    {label}
                  </button>
                ))}
              </div>
            </Row>
            <Row
              title="Before launch"
              description="A command run in the profile’s folder before the game starts. If it fails, the game doesn’t start."
            >
              <input
                className="input input-mono inline-field"
                value={settings.preLaunchCommand}
                placeholder="e.g. a backup script"
                spellCheck={false}
                onChange={(e) => update({ preLaunchCommand: e.target.value }, TEXT_SAVE_MS)}
                aria-label="Before launch command"
              />
            </Row>
            <Row title="After the game closes" description="A command run in the profile’s folder once the game has exited.">
              <input
                className="input input-mono inline-field"
                value={settings.postExitCommand}
                placeholder="e.g. a sync script"
                spellCheck={false}
                onChange={(e) => update({ postExitCommand: e.target.value }, TEXT_SAVE_MS)}
                aria-label="After the game closes command"
              />
            </Row>
            <p className="settings-note">
              Both commands can use <code>WORKBENCH_GAME_DIR</code>, <code>WORKBENCH_PROFILE_NAME</code>, <code>WORKBENCH_PROFILE_ID</code>,{' '}
              <code>WORKBENCH_MC_VERSION</code> and <code>WORKBENCH_LOADER</code>.
            </p>
          </Section>

          <Section id="game" title="Game defaults" description="Used by every profile that doesn’t set its own in its Settings tab.">
            <Row title="Memory" description="Maximum RAM Minecraft can use. 4 GB is plenty for vanilla.">
              <div className="memory-control">
                <MemorySlider value={settings.memoryMb} max={maxMemory} onChange={(memoryMb) => update({ memoryMb }, 300)} />
              </div>
            </Row>
            <Row title="Java arguments" description="Extra JVM flags for every profile. A profile’s own arguments are added after these.">
              <input
                className="input input-mono inline-field"
                value={settings.jvmArgs}
                placeholder="-XX:+UseG1GC"
                spellCheck={false}
                onChange={(e) => update({ jvmArgs: e.target.value }, TEXT_SAVE_MS)}
                aria-label="Java arguments"
              />
            </Row>
            <Row title="Window size" description={resolution ? 'Size of the game window when it opens.' : 'Uses the game’s default size.'}>
              <div className="memory-control">
                {resolution && <ResolutionFields value={resolution} onChange={setSize} />}
                <Toggle label="Custom window size" checked={Boolean(resolution)} onChange={(on) => update({ resolution: on ? DEFAULT_RESOLUTION : null })} />
              </div>
            </Row>
            <Row title="Start in fullscreen" description="The game opens fullscreen. F11 switches back in game.">
              <Toggle label="Start in fullscreen" checked={settings.fullscreen} onChange={(on) => update({ fullscreen: on })} />
            </Row>
            <Row title="Share game settings" description="New profiles start with the keybinds, video and sound settings of the profile you played last.">
              <Toggle label="Share game settings" checked={settings.shareOptions} onChange={(on) => update({ shareOptions: on })} />
            </Row>
          </Section>

          <Section id="worlds" title="Worlds">
            <Row title="Back up worlds automatically" description="After you play, worlds that changed are backed up.">
              <Toggle label="Back up worlds automatically" checked={settings.autoBackup} onChange={(on) => update({ autoBackup: on })} />
            </Row>
            <Row
              title="Backups to keep"
              description="Automatic backups kept for each world; older ones are removed. Backups you make yourself are never removed."
            >
              <input
                type="number"
                className="input settings-number"
                value={settings.backupsToKeep}
                min={1}
                max={50}
                disabled={!settings.autoBackup}
                onChange={(e) => {
                  const n = Math.round(Number(e.target.value));
                  update({ backupsToKeep: n }, TEXT_SAVE_MS, n >= 1 && n <= 50);
                }}
                aria-label="Backups to keep"
              />
            </Row>
          </Section>

          <Section id="discord" title="Discord">
            <Row
              title="Show what you’re playing"
              description={
                system.discord
                  ? 'Your Discord status shows Workbench while it’s open, and what you’re playing in game.'
                  : 'Not set up in this build of Workbench yet.'
              }
            >
              <Toggle
                label="Show what you’re playing on Discord"
                checked={settings.discordPresence && system.discord}
                disabled={!system.discord}
                onChange={(on) => update({ discordPresence: on })}
              />
            </Row>
            <Row title="Show profile names" description="Off, your status says “Playing Minecraft” with the version, but not which profile.">
              <Toggle
                label="Show profile names on Discord"
                checked={settings.discordShowProfile}
                disabled={!system.discord || !settings.discordPresence}
                onChange={(on) => update({ discordShowProfile: on })}
              />
            </Row>
          </Section>

          <Section id="storage" title="Storage">
            <Row title="Data folder" description={<span className="path-text">{system.dataDir}</span>}>
              <button className="btn btn-secondary" onClick={() => api.system.openDataFolder().catch((err) => onError(errorMessage(err)))}>
                <FolderOpen size={15} /> Open
              </button>
            </Row>
            <StorageRow onError={onError} />
            <Row title="Parallel downloads" description="Files downloaded at once when installing a version. Lower it if installs fail on a slow connection.">
              <div className="segmented" role="group" aria-label="Parallel downloads">
                {DOWNLOAD_THREADS.map((n) => (
                  <button key={n} aria-pressed={settings.downloadThreads === n} onClick={() => update({ downloadThreads: n })}>
                    {n}
                  </button>
                ))}
              </div>
            </Row>
          </Section>

          <Section id="help" title="Updates & help">
            <UpdatesRow version={system.version} onError={onError} />
            <SystemInfoRow system={system} />
            <JavaRow onError={onError} />
            <ResetRow
              onReset={(next) => {
                setSettings(next);
                setReduceMotion(false);
                // Custom themes are kept; they took work to make.
                const { customThemes: _kept, ...looks } = APPEARANCE_DEFAULTS;
                onAppearanceChange(looks);
                api.appearance.removeBackground().catch(() => {});
                setResets((n) => n + 1);
              }}
              onError={onError}
            />
          </Section>
        </div>
      </div>
    </>
  );
}

const USAGE_PARTS: { key: keyof StorageUsage; label: string }[] = [
  { key: 'profiles', label: 'Profiles' },
  { key: 'shared', label: 'Shared game files' },
  { key: 'java', label: 'Java' },
  { key: 'backups', label: 'World backups' },
];

function StorageRow({ onError }: { onError: (message: string) => void }) {
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  useEffect(() => {
    api.system
      .usage()
      .then(setUsage)
      .catch((err) => onError(errorMessage(err)));
  }, [onError]);

  const total = usage ? USAGE_PARTS.reduce((sum, p) => sum + usage[p.key], 0) : 0;
  return (
    <div className="settings-row settings-row-stacked">
      <div>
        <h3>Space used{usage && total > 0 && <span className="settings-usage-total"> · {formatBytes(total)}</span>}</h3>
        <p>Shared game files are the versions, libraries and sounds every profile reuses.</p>
      </div>
      {usage ? (
        <div className="usage">
          <div className="usage-bar" aria-hidden>
            {USAGE_PARTS.map((p) => (
              <span key={p.key} className={`usage-part usage-${p.key}`} style={{ flexGrow: usage[p.key] }} />
            ))}
          </div>
          <ul className="usage-legend">
            {USAGE_PARTS.map((p) => (
              <li key={p.key}>
                <span className={`usage-swatch usage-${p.key}`} />
                {p.label}
                <strong>{usage[p.key] ? formatBytes(usage[p.key]) : 'None'}</strong>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="settings-usage-loading">Adding it up…</p>
      )}
    </div>
  );
}

function updateText(status: UpdateStatus | null, version: string) {
  switch (status?.state) {
    case 'unsupported':
      return `You’re on v${version}. Development builds don’t update themselves.`;
    case 'checking':
      return 'Checking for a new version…';
    case 'downloading':
      return `Downloading v${status.version}${status.percent ? ` (${status.percent}%)` : ''}…`;
    case 'ready':
      return `v${status.version} is ready. Restart Workbench to install it.`;
    case 'latest':
      return `You’re on the newest version, v${version}.`;
    case 'error':
      return `Couldn’t check for updates. You’re on v${version}.`;
    default:
      return `You’re on v${version}. New versions download by themselves and install when you restart.`;
  }
}

function UpdatesRow({ version, onError }: { version: string; onError: (message: string) => void }) {
  const [status, setStatus] = useUpdateStatus();

  const busy = status?.state === 'checking' || status?.state === 'downloading';
  return (
    <Row title="Updates" description={updateText(status, version)}>
      {status?.state === 'ready' ? (
        <button className="btn btn-primary" onClick={() => api.updates.install().catch((err) => onError(errorMessage(err)))}>
          <Download size={15} /> Restart to update
        </button>
      ) : (
        <button
          className="btn btn-secondary"
          disabled={busy || status?.state === 'unsupported'}
          onClick={() =>
            api.updates
              .check()
              .then(setStatus)
              .catch((err) => onError(errorMessage(err)))
          }
        >
          <RefreshCw size={15} className={busy ? 'spin' : undefined} /> Check now
        </button>
      )}
    </Row>
  );
}

function SystemInfoRow({ system }: { system: SystemInfo }) {
  const [copied, setCopied] = useState(false);
  const text = [
    `Workbench ${system.version}`,
    `OS: ${system.os}`,
    `Electron: ${system.electron}`,
    `Memory: ${formatGb(system.totalMemoryMb)}`,
    `Data folder: ${system.dataDir}`,
  ].join('\n');
  const copy = () =>
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  return (
    <Row title="System info" description={`Workbench ${system.version} on ${system.os}. Paste it into a bug report.`}>
      <button className="btn btn-secondary" onClick={copy}>
        {copied ? <Check size={15} /> : <ClipboardCopy size={15} />} {copied ? 'Copied' : 'Copy'}
      </button>
    </Row>
  );
}

function JavaRow({ onError }: { onError: (message: string) => void }) {
  const [state, setState] = useState<'idle' | 'working' | 'done'>('idle');
  const run = async () => {
    setState('working');
    try {
      await api.system.removeJava();
      setState('done');
    } catch (err) {
      onError(errorMessage(err));
      setState('idle');
    }
  };
  return (
    <Row
      title="Download Java again"
      description={
        state === 'done'
          ? 'Done. Java downloads again the next time you play.'
          : 'If the game won’t start with a Java error, this clears Workbench’s copies of Java so the next launch gets fresh ones.'
      }
    >
      <button className="btn btn-secondary" onClick={run} disabled={state !== 'idle'}>
        {state === 'done' ? <Check size={15} /> : <Coffee size={15} />} {state === 'working' ? 'Clearing…' : 'Clear Java'}
      </button>
    </Row>
  );
}

function ResetRow({ onReset, onError }: { onReset: (settings: Settings) => void; onError: (message: string) => void }) {
  const [confirming, setConfirming] = useState(false);
  const reset = async () => {
    try {
      onReset(await api.settings.reset());
      setConfirming(false);
    } catch (err) {
      onError(errorMessage(err));
    }
  };
  return (
    <>
      <Row title="Reset settings" description="Puts everything on this page back to how it started. Profiles, worlds and accounts aren’t touched.">
        <button className="btn btn-secondary" onClick={() => setConfirming(true)}>
          <RotateCcw size={15} /> Reset
        </button>
      </Row>
      {confirming && (
        <Modal
          title="Reset settings?"
          onClose={() => setConfirming(false)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setConfirming(false)}>
                Cancel
              </button>
              <button className="btn btn-danger-fill" onClick={reset}>
                <RefreshCw size={15} /> Reset settings
              </button>
            </>
          }
        >
          <p className="modal-text">Memory, launch commands, backups, Discord and the other settings here go back to their defaults.</p>
        </Modal>
      )}
    </>
  );
}
