import { useState } from 'react';
import { ArrowRight, Check, Compass, FileDown, LogIn, Monitor, Moon, Plus, Sun } from 'lucide-react';
import logo from '../assets/logo.svg';
import type { AccountsState, ThemePreference } from '../types';

const THEMES: { id: ThemePreference; label: string; hint: string; icon: typeof Sun }[] = [
  { id: 'light', label: 'Cream', hint: 'Light', icon: Sun },
  { id: 'dark', label: 'Charcoal', hint: 'Dark', icon: Moon },
  { id: 'system', label: 'Match system', hint: 'Follows Windows', icon: Monitor },
];

const STEPS = ['Account', 'Look', 'First profile'] as const;

export type WelcomeChoice = 'new' | 'import' | 'browse' | 'none';

interface Props {
  accounts: AccountsState;
  onLogin: () => void;
  theme: string;
  onThemeChange: (theme: ThemePreference) => void;
  /** Ends the welcome; the choice says where to go next. */
  onDone: (choice: WelcomeChoice) => void;
}

/** The first thing a new player sees: sign in, pick a look, make a profile. Every step can be skipped. */
export default function Welcome({ accounts, onLogin, theme, onThemeChange, onDone }: Props) {
  const [step, setStep] = useState(0);
  const account = accounts.accounts.find((a) => a.id === accounts.activeId);
  const next = () => setStep((s) => s + 1);

  return (
    <div className="welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div className="welcome-card">
        <img className="welcome-logo" src={logo} alt="" />
        <ol className="welcome-steps" aria-label="Steps">
          {STEPS.map((label, i) => (
            <li key={label} aria-current={i === step ? 'step' : undefined} data-done={i < step || undefined}>
              <span className="welcome-step-dot">{i < step ? <Check size={12} strokeWidth={3} /> : i + 1}</span>
              {label}
            </li>
          ))}
        </ol>

        {step === 0 && (
          <>
            <h1 id="welcome-title">Welcome to Workbench</h1>
            <p className="welcome-lead">
              A launcher for Minecraft: Java Edition that keeps your mods, modpacks and worlds in tidy profiles. Sign in with the Microsoft account
              that owns the game to play.
            </p>
            {account ? (
              <div className="welcome-signed-in">
                <Check size={18} />
                <span>
                  Signed in as <strong>{account.name}</strong>
                </span>
              </div>
            ) : (
              <button className="btn btn-primary btn-lg" onClick={onLogin}>
                <LogIn size={18} /> Sign in with Microsoft
              </button>
            )}
            <div className="welcome-actions">
              <button className="btn btn-ghost" onClick={next}>
                {account ? 'Next' : 'Do this later'} <ArrowRight size={16} />
              </button>
            </div>
            {!account && <p className="welcome-note">You can sign in any time from the bottom of the sidebar.</p>}
          </>
        )}

        {step === 1 && (
          <>
            <h1 id="welcome-title">Pick a look</h1>
            <p className="welcome-lead">You can change this later in Settings.</p>
            <div className="welcome-themes" role="group" aria-label="Theme">
              {THEMES.map(({ id, label, hint, icon: Icon }) => (
                <button key={id} className={`welcome-theme welcome-theme-${id}`} aria-pressed={theme === id} onClick={() => onThemeChange(id)}>
                  <span className="welcome-theme-swatch" aria-hidden>
                    <Icon size={18} />
                  </span>
                  <strong>{label}</strong>
                  <small>{hint}</small>
                </button>
              ))}
            </div>
            <div className="welcome-actions">
              <button className="btn btn-primary" onClick={next}>
                Next <ArrowRight size={16} />
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h1 id="welcome-title">Make your first profile</h1>
            <p className="welcome-lead">A profile is one Minecraft setup: a version, its mods and its own worlds.</p>
            <div className="welcome-choices">
              <button className="welcome-choice" onClick={() => onDone('new')}>
                <Plus size={20} />
                <strong>Start fresh</strong>
                <small>Pick a Minecraft version and, if you like, a mod loader.</small>
              </button>
              <button className="welcome-choice" onClick={() => onDone('browse')}>
                <Compass size={20} />
                <strong>Find a modpack</strong>
                <small>Browse ready-made packs on Modrinth and install one.</small>
              </button>
              <button className="welcome-choice" onClick={() => onDone('import')}>
                <FileDown size={20} />
                <strong>Import</strong>
                <small>A .workbench or .mrpack file, or a share code from a friend.</small>
              </button>
            </div>
            <div className="welcome-actions">
              <button className="btn btn-ghost" onClick={() => onDone('none')}>
                I’ll look around first
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
