import { useState } from 'react';
import { Check, ClipboardCopy, ClipboardPaste, ImagePlus, Plus, RotateCcw, Trash2 } from 'lucide-react';
import Modal from './Modal';
import Toggle from './Toggle';
import { Row, Section } from './SettingsRows';
import { api, errorMessage } from '../api';
import {
  ACCENTS,
  BUILTIN_THEMES,
  SCALE_MAX,
  SCALE_MIN,
  accentColor,
  contrast,
  resolveTheme,
  themeFromCode,
  themeFromCurrent,
  themeToCode,
  type Appearance,
  type CustomTheme,
} from '../appearance';
import { reduceMotionStored, setReduceMotion } from '../motion';

interface Props {
  appearance: Appearance;
  onChange: (patch: Partial<Appearance>) => void;
  onError: (message: string) => void;
}

const percent = (n: number) => `${Math.round(n * 100)}%`;

/** Settings → Appearance: themes (built-in and your own), accent colour, size, density and background. */
export default function AppearanceSection({ appearance, onChange, onError }: Props) {
  const [reduceMotion, setReduceMotionState] = useState(reduceMotionStored);
  const [importing, setImporting] = useState(false);
  const [copied, setCopied] = useState(false);

  const editing = appearance.customThemes.find((t) => t.id === appearance.theme) ?? null;
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const mode = resolveTheme(appearance, systemDark).mode;

  const saveTheme = (theme: CustomTheme) =>
    onChange({ customThemes: appearance.customThemes.map((t) => (t.id === theme.id ? theme : t)) });

  const addTheme = (theme: CustomTheme) => onChange({ customThemes: [...appearance.customThemes, theme], theme: theme.id });

  const deleteTheme = (id: string) =>
    onChange({ customThemes: appearance.customThemes.filter((t) => t.id !== id), theme: appearance.theme === id ? 'system' : appearance.theme });

  const copyCode = (theme: CustomTheme) =>
    navigator.clipboard.writeText(themeToCode(theme)).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => onError('Couldn’t copy to the clipboard.'),
    );

  const pickBackground = async () => {
    try {
      const version = await api.appearance.pickBackground();
      if (version) onChange({ background: version });
    } catch (err) {
      onError(errorMessage(err));
    }
  };

  const removeBackground = () =>
    api.appearance
      .removeBackground()
      .then(() => onChange({ background: null }))
      .catch((err) => onError(errorMessage(err)));

  return (
    <Section id="appearance" title="Appearance">
      <div className="settings-row settings-row-stacked">
        <div>
          <h3>Theme</h3>
          <p>Pick one, or make your own from three colours.</p>
        </div>
        <div className="theme-grid" role="radiogroup" aria-label="Theme">
          {BUILTIN_THEMES.map((t) => (
            <ThemeCard
              key={t.id}
              label={t.label}
              swatch={t.swatch}
              split={t.id === 'system'}
              selected={appearance.theme === t.id}
              onSelect={() => onChange({ theme: t.id })}
            />
          ))}
          {appearance.customThemes.map((t) => (
            <ThemeCard
              key={t.id}
              label={t.name}
              swatch={[t.background, t.surface, t.text]}
              accent={t.accent}
              selected={appearance.theme === t.id}
              onSelect={() => onChange({ theme: t.id })}
            />
          ))}
          <button className="theme-card theme-card-new" onClick={() => addTheme(themeFromCurrent(mode, `My theme ${appearance.customThemes.length + 1}`))}>
            <Plus size={18} />
            <span>New theme</span>
          </button>
        </div>
        <div className="theme-grid-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => setImporting(true)}>
            <ClipboardPaste size={14} /> Paste a theme code
          </button>
        </div>
      </div>

      {editing && <ThemeEditor theme={editing} copied={copied} onChange={saveTheme} onCopy={() => copyCode(editing)} onDelete={() => deleteTheme(editing.id)} />}

      <Row
        title="Accent colour"
        description={
          editing?.accent ? `Set by ${editing.name}. Turn off its own accent to use this.` : 'Buttons, highlights and the selected page.'
        }
      >
        <div className="accent-swatches" role="radiogroup" aria-label="Accent colour">
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              role="radio"
              aria-checked={appearance.accent === a.id}
              aria-label={a.label}
              title={a.label}
              className="accent-swatch"
              style={{ background: a.color }}
              disabled={Boolean(editing?.accent)}
              onClick={() => onChange({ accent: a.id })}
            >
              {appearance.accent === a.id && <Check size={14} strokeWidth={3} />}
            </button>
          ))}
          <label
            className="accent-swatch accent-swatch-custom"
            title="Any colour"
            aria-checked={appearance.accent.startsWith('#')}
            style={appearance.accent.startsWith('#') ? { background: appearance.accent } : undefined}
          >
            <input
              type="color"
              value={accentColor(appearance.accent)}
              disabled={Boolean(editing?.accent)}
              onChange={(e) => onChange({ accent: e.target.value })}
              aria-label="Custom accent colour"
            />
            {appearance.accent.startsWith('#') ? <Check size={14} strokeWidth={3} /> : <Plus size={14} strokeWidth={3} />}
          </label>
        </div>
      </Row>

      <Row title="Interface size" description="Makes everything in the launcher bigger or smaller.">
        <div className="memory-control">
          <input
            type="range"
            className="range"
            min={SCALE_MIN}
            max={SCALE_MAX}
            step={0.05}
            value={appearance.scale}
            onChange={(e) => onChange({ scale: Number(e.target.value) })}
            aria-label="Interface size"
          />
          <span className="memory-value">{percent(appearance.scale)}</span>
          <button className="icon-btn" title="Reset to 100%" aria-label="Reset interface size" disabled={appearance.scale === 1} onClick={() => onChange({ scale: 1 })}>
            <RotateCcw size={15} />
          </button>
        </div>
      </Row>

      <Row title="Compact mode" description="Tighter rows and spacing, so long lists of mods and profiles fit on screen.">
        <Toggle label="Compact mode" checked={appearance.compact} onChange={(compact) => onChange({ compact })} />
      </Row>

      <Row title="Background image" description={appearance.background ? 'Shown softly behind every page.' : 'A picture behind every page. PNG, JPEG, WebP or GIF.'}>
        <div className="icon-actions">
          {appearance.background && (
            <button className="btn btn-ghost" onClick={removeBackground}>
              Remove
            </button>
          )}
          <button className="btn btn-secondary" onClick={pickBackground}>
            <ImagePlus size={15} /> {appearance.background ? 'Change' : 'Choose image'}
          </button>
        </div>
      </Row>
      <Row title="Profile covers" description="On a profile’s page, show its cover screenshot in the background instead.">
        <Toggle label="Profile covers" checked={appearance.profileCovers} onChange={(profileCovers) => onChange({ profileCovers })} />
      </Row>
      {(appearance.background || appearance.profileCovers) && (
        <>
          <Row title="Background fade" description="How much the page colour covers the image. More is easier to read.">
            <div className="memory-control">
              <input
                type="range"
                className="range"
                min={0}
                max={0.9}
                step={0.05}
                value={appearance.backgroundDim}
                onChange={(e) => onChange({ backgroundDim: Number(e.target.value) })}
                aria-label="Background fade"
              />
              <span className="memory-value">{percent(appearance.backgroundDim)}</span>
            </div>
          </Row>
          <Row title="Blur background" description="Softens the image so it stays out of the way.">
            <Toggle label="Blur background" checked={appearance.backgroundBlur} onChange={(backgroundBlur) => onChange({ backgroundBlur })} />
          </Row>
        </>
      )}

      <Row title="Reduce motion" description="Turns off sliding, spinning and fading. Your system setting for this is always followed too.">
        <Toggle
          label="Reduce motion"
          checked={reduceMotion}
          onChange={(on) => {
            setReduceMotionState(on);
            setReduceMotion(on);
          }}
        />
      </Row>

      {importing && (
        <ImportThemeModal
          onClose={() => setImporting(false)}
          onImport={(theme) => {
            addTheme(theme);
            setImporting(false);
          }}
        />
      )}
    </Section>
  );
}

function ThemeCard({
  label,
  swatch: [background, surface, text],
  accent,
  split,
  selected,
  onSelect,
}: {
  label: string;
  swatch: [string, string, string];
  accent?: string | null;
  split?: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button role="radio" aria-checked={selected} className="theme-card" onClick={onSelect}>
      <span
        className="theme-card-preview"
        style={split ? { background: `linear-gradient(135deg, ${background} 50%, ${surface} 50%)` } : { background }}
      >
        {!split && (
          <span className="theme-card-panel" style={{ background: surface }}>
            <span style={{ background: text }} />
            <span style={{ background: text }} />
            <span className="theme-card-dot" style={{ background: accent ?? 'var(--accent)' }} />
          </span>
        )}
      </span>
      <span className="theme-card-label">
        {selected && <Check size={13} strokeWidth={3} />}
        {label}
      </span>
    </button>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  return (
    <label className="color-field">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
      <span>
        {label}
        <code>{value}</code>
      </span>
    </label>
  );
}

function ThemeEditor({
  theme,
  copied,
  onChange,
  onCopy,
  onDelete,
}: {
  theme: CustomTheme;
  copied: boolean;
  onChange: (theme: CustomTheme) => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const set = (patch: Partial<CustomTheme>) => onChange({ ...theme, ...patch });
  const readable = contrast(theme.text, theme.surface) >= 4.5 && contrast(theme.text, theme.background) >= 4.5;

  return (
    <div className="settings-row settings-row-stacked theme-editor">
      <div className="theme-editor-head">
        <input
          className="input theme-editor-name"
          value={theme.name}
          maxLength={32}
          onChange={(e) => set({ name: e.target.value })}
          aria-label="Theme name"
        />
        <div className="segmented" role="group" aria-label="Light or dark">
          <button aria-pressed={theme.mode === 'light'} onClick={() => set({ mode: 'light' })}>
            Light
          </button>
          <button aria-pressed={theme.mode === 'dark'} onClick={() => set({ mode: 'dark' })}>
            Dark
          </button>
        </div>
      </div>
      <div className="theme-editor-colors">
        <ColorField label="Background" value={theme.background} onChange={(background) => set({ background })} />
        <ColorField label="Panels" value={theme.surface} onChange={(surface) => set({ surface })} />
        <ColorField label="Text" value={theme.text} onChange={(text) => set({ text })} />
        <div className="theme-editor-accent">
          {theme.accent ? (
            <ColorField label="Accent" value={theme.accent} onChange={(accent) => set({ accent })} />
          ) : (
            <span className="theme-editor-accent-off">Accent from the setting below</span>
          )}
          <Toggle label="Own accent colour" checked={theme.accent !== null} onChange={(on) => set({ accent: on ? '#fec424' : null })} />
        </div>
      </div>
      {!readable && <p className="theme-editor-warning">Text may be hard to read on these colours. Try more contrast.</p>}
      <div className="theme-editor-actions">
        <button className="btn btn-secondary btn-sm" onClick={onCopy}>
          {copied ? <Check size={14} /> : <ClipboardCopy size={14} />} {copied ? 'Copied' : 'Copy theme code'}
        </button>
        <button className="btn btn-ghost btn-sm theme-editor-delete" onClick={onDelete}>
          <Trash2 size={14} /> Delete theme
        </button>
      </div>
    </div>
  );
}

function ImportThemeModal({ onClose, onImport }: { onClose: () => void; onImport: (theme: CustomTheme) => void }) {
  const [code, setCode] = useState('');
  const theme = code.trim() ? themeFromCode(code) : null;

  return (
    <Modal
      title="Paste a theme code"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!theme} onClick={() => theme && onImport(theme)}>
            Add theme
          </button>
        </>
      }
    >
      <p className="modal-text">Someone shared a theme? Paste its code here.</p>
      <textarea
        className="input share-code"
        rows={4}
        value={code}
        placeholder="WBTHEME1:…"
        spellCheck={false}
        autoFocus
        onChange={(e) => setCode(e.target.value)}
        aria-label="Theme code"
      />
      {code.trim() && !theme && <p className="form-error">That isn’t a theme code.</p>}
      {theme && (
        <p className="modal-text">
          <strong>{theme.name}</strong>, a {theme.mode} theme.
        </p>
      )}
    </Modal>
  );
}
