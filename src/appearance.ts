import { useEffect, useState } from 'react';
import { api } from './api';
import { writeStored } from './stored';

// How the launcher looks: theme, accent colour, custom themes, density, size and background.
// Kept per device in localStorage. index.html applies a cached copy before the page paints.

export type ThemeMode = 'light' | 'dark';

export interface CustomTheme {
  id: string;
  name: string;
  mode: ThemeMode;
  /** #rrggbb */
  background: string;
  surface: string;
  text: string;
  /** Overrides the accent setting while this theme is on; null follows it. */
  accent: string | null;
}

export interface Appearance {
  /** 'system', a built-in theme's id, or a custom theme's id. */
  theme: string;
  /** An ACCENTS id, or a #rrggbb colour. */
  accent: string;
  customThemes: CustomTheme[];
  compact: boolean;
  /** Interface zoom. */
  scale: number;
  /** Version of the stored background image; null for none. */
  background: string | null;
  /** How much the page colour covers the background image, 0 to 0.9. */
  backgroundDim: number;
  backgroundBlur: boolean;
  /** On a profile's page, show its cover screenshot behind it. */
  profileCovers: boolean;
}

export const BUILTIN_THEMES: { id: string; label: string; mode: ThemeMode | null; swatch: [string, string, string] }[] = [
  { id: 'system', label: 'System', mode: null, swatch: ['#fef3dd', '#1c1c1d', '#fec424'] },
  { id: 'light', label: 'Cream', mode: 'light', swatch: ['#fef3dd', '#fff8ea', '#2a2a2b'] },
  { id: 'paper', label: 'Paper', mode: 'light', swatch: ['#f4f4f2', '#ffffff', '#1f1f20'] },
  { id: 'dark', label: 'Charcoal', mode: 'dark', swatch: ['#1c1c1d', '#2a2a2b', '#f6f1e6'] },
  { id: 'midnight', label: 'Midnight', mode: 'dark', swatch: ['#000000', '#111112', '#f2f2f2'] },
  { id: 'contrast', label: 'High contrast', mode: 'dark', swatch: ['#000000', '#0d0d0d', '#ffffff'] },
];

export const ACCENTS = [
  { id: 'yellow', label: 'Workbench yellow', color: '#fec424' },
  { id: 'orange', label: 'Orange', color: '#f97316' },
  { id: 'red', label: 'Red', color: '#ef4444' },
  { id: 'pink', label: 'Pink', color: '#ec4899' },
  { id: 'purple', label: 'Purple', color: '#8b5cf6' },
  { id: 'blue', label: 'Blue', color: '#3b82f6' },
  { id: 'teal', label: 'Teal', color: '#14b8a6' },
  { id: 'green', label: 'Green', color: '#22c55e' },
];

export const SCALE_MIN = 0.8;
export const SCALE_MAX = 1.3;

const STORAGE_KEY = 'workbench.appearance';
// What index.html applies before the first paint: { theme, palette, density, vars, background }.
const CACHE_KEY = 'workbench.appearanceCache';

export const APPEARANCE_DEFAULTS: Appearance = {
  theme: 'system',
  accent: 'yellow',
  customThemes: [],
  compact: false,
  scale: 1,
  background: null,
  backgroundDim: 0.6,
  backgroundBlur: false,
  profileCovers: false,
};

const HEX = /^#[0-9a-f]{6}$/i;
const isHex = (v: unknown): v is string => typeof v === 'string' && HEX.test(v);
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** A theme as read from storage or a share code, or null if it isn't one. */
function cleanTheme(t: Partial<CustomTheme> | null | undefined, id: string): CustomTheme | null {
  if (!t || !isHex(t.background) || !isHex(t.surface) || !isHex(t.text)) return null;
  return {
    id,
    name: String(t.name ?? '').trim().slice(0, 32) || 'Custom theme',
    mode: t.mode === 'light' ? 'light' : 'dark',
    background: t.background.toLowerCase(),
    surface: t.surface.toLowerCase(),
    text: t.text.toLowerCase(),
    accent: isHex(t.accent) ? t.accent.toLowerCase() : null,
  };
}

function load(): Appearance {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (!saved) {
      // Before themes were customizable, only light/dark/system was stored.
      const theme = localStorage.getItem('workbench.theme');
      return { ...APPEARANCE_DEFAULTS, theme: theme === 'light' || theme === 'dark' ? theme : 'system' };
    }
    const customThemes = (Array.isArray(saved.customThemes) ? saved.customThemes : [])
      .map((t: CustomTheme) => cleanTheme(t, String(t?.id ?? '')))
      .filter((t: CustomTheme | null): t is CustomTheme => Boolean(t?.id));
    const known = (id: unknown) => BUILTIN_THEMES.some((t) => t.id === id) || customThemes.some((t: CustomTheme) => t.id === id);
    return {
      theme: known(saved.theme) ? saved.theme : 'system',
      accent: ACCENTS.some((a) => a.id === saved.accent) || isHex(saved.accent) ? saved.accent : 'yellow',
      customThemes,
      compact: Boolean(saved.compact),
      scale: clamp(Number(saved.scale) || 1, SCALE_MIN, SCALE_MAX),
      background: typeof saved.background === 'string' ? saved.background : null,
      backgroundDim: clamp(Number(saved.backgroundDim ?? APPEARANCE_DEFAULTS.backgroundDim), 0, 0.9),
      backgroundBlur: Boolean(saved.backgroundBlur),
      profileCovers: Boolean(saved.profileCovers),
    };
  } catch {
    return APPEARANCE_DEFAULTS;
  }
}

// ---------- Colour maths ----------

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

function luminance(hex: string) {
  const [r, g, b] = channels(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const DARK_INK = '#2a2a2b';
const LIGHT_INK = '#ffffff';

/** Charcoal or white, whichever reads better on the colour. */
export const inkOn = (hex: string) => (contrast(hex, DARK_INK) >= contrast(hex, LIGHT_INK) ? DARK_INK : LIGHT_INK);

export const accentColor = (accent: string) => ACCENTS.find((a) => a.id === accent)?.color ?? accent;

function accentVars(hex: string, mode: ThemeMode): Record<string, string> {
  const tint = `color-mix(in srgb, ${hex} 18%, var(--bg-surface))`;
  return {
    '--accent': hex,
    '--accent-hover': `color-mix(in srgb, ${hex} 86%, ${mode === 'dark' ? '#ffffff' : '#000000'})`,
    '--accent-text': inkOn(hex),
    '--nav-active-bg': tint,
    '--icon-tile-bg': tint,
    '--nav-active-text': mode === 'dark' ? `color-mix(in srgb, ${hex} 80%, #ffffff)` : 'var(--text)',
  };
}

/** Every colour token, worked out from a custom theme's three colours. */
function themeVars(t: CustomTheme): Record<string, string> {
  const mix = (a: string, b: string, pct: number) => `color-mix(in srgb, ${a}, ${b} ${pct}%)`;
  return {
    '--bg-app': t.background,
    '--bg-sidebar': mix(t.background, t.mode === 'dark' ? '#000000' : '#ffffff', 30),
    '--bg-surface': t.surface,
    '--bg-surface-hover': mix(t.surface, t.text, 5),
    '--bg-muted': mix(t.surface, t.text, 8),
    '--border': mix(t.surface, t.text, 11),
    '--border-strong': mix(t.surface, t.text, 19),
    '--text': t.text,
    '--text-muted': mix(t.text, t.background, 36),
    '--text-faint': mix(t.text, t.background, 60),
    '--logo-text': t.text,
    '--shadow-card': 'none',
  };
}

/** A CSS colour (variables, color-mix…) as #rrggbb, by painting it. */
function resolveColor(cssVar: string) {
  const probe = document.createElement('span');
  probe.style.color = `var(${cssVar})`;
  document.body.appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!ctx) return '#000000';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

// ---------- Applying ----------

export function resolveTheme(a: Appearance, systemDark: boolean) {
  const custom = a.customThemes.find((t) => t.id === a.theme) ?? null;
  if (custom) return { mode: custom.mode, palette: null, custom };
  const id = a.theme === 'system' ? (systemDark ? 'dark' : 'light') : a.theme;
  const builtin = BUILTIN_THEMES.find((t) => t.id === id) ?? BUILTIN_THEMES[1];
  const mode = builtin.mode ?? 'light';
  // Cream and Charcoal are the stylesheet's own light and dark; the rest adjust them.
  return { mode, palette: id === 'light' || id === 'dark' ? null : id, custom: null };
}

// Variables set on the page; index.html sets the cached ones before the app starts.
let applied: string[] = (() => {
  try {
    return Object.keys(JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null')?.vars ?? {});
  } catch {
    return [];
  }
})();

function applyAppearance(a: Appearance, systemDark: boolean) {
  const root = document.documentElement;
  const { mode, palette, custom } = resolveTheme(a, systemDark);
  root.dataset.theme = mode;
  if (palette) root.dataset.palette = palette;
  else delete root.dataset.palette;
  if (a.compact) root.dataset.density = 'compact';
  else delete root.dataset.density;

  const accent = custom?.accent ?? accentColor(a.accent);
  const vars: Record<string, string> = {
    ...(custom ? themeVars(custom) : {}),
    // The stylesheet's own yellow is tuned by hand for each theme; other colours are worked out.
    ...(accent === ACCENTS[0].color && !custom ? {} : accentVars(accent, mode)),
    '--ui-scale': String(a.scale),
  };
  for (const name of applied) if (!(name in vars)) root.style.removeProperty(name);
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
  applied = Object.keys(vars);

  const background = resolveColor('--bg-app');
  api.window
    .setLook({ dark: mode === 'dark', background, sidebar: resolveColor('--bg-sidebar'), text: resolveColor('--text'), zoom: a.scale })
    .catch(() => {});
  writeStored(CACHE_KEY, JSON.stringify({ theme: mode, palette, density: a.compact ? 'compact' : null, vars, background }));
}

/** The appearance and a function to change part of it; changes apply (and are saved) at once. */
export function useAppearance() {
  const [appearance, setAppearance] = useState<Appearance>(load);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => applyAppearance(appearance, media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [appearance]);

  const update = (patch: Partial<Appearance>) =>
    setAppearance((prev) => {
      const next = { ...prev, ...patch };
      writeStored(STORAGE_KEY, JSON.stringify(next));
      return next;
    });

  return [appearance, update] as const;
}

// ---------- Custom themes ----------

const newId = () => `custom-${Date.now().toString(36)}`;

/** A new custom theme that starts from the colours on screen now. */
export function themeFromCurrent(mode: ThemeMode, name: string): CustomTheme {
  return {
    id: newId(),
    name,
    mode,
    background: resolveColor('--bg-app'),
    surface: resolveColor('--bg-surface'),
    text: resolveColor('--text'),
    accent: null,
  };
}

const CODE_PREFIX = 'WBTHEME1:';

/** Text to paste to a friend; themeFromCode reads it back. */
export function themeToCode(t: CustomTheme) {
  const { name, mode, background, surface, text, accent } = t;
  return CODE_PREFIX + btoa(unescape(encodeURIComponent(JSON.stringify({ name, mode, background, surface, text, accent }))));
}

export function themeFromCode(code: string): CustomTheme | null {
  const text = code.trim();
  if (!text.startsWith(CODE_PREFIX)) return null;
  try {
    return cleanTheme(JSON.parse(decodeURIComponent(escape(atob(text.slice(CODE_PREFIX.length))))), newId());
  } catch {
    return null;
  }
}
