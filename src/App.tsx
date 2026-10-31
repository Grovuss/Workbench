import { useCallback, useEffect, useState } from 'react';
import Sidebar from './components/Sidebar';
import Toasts from './components/Toasts';
import ProfilesPage from './pages/ProfilesPage';
import ImportPage from './pages/ImportPage';
import ModsPage from './pages/ModsPage';
import SettingsPage from './pages/SettingsPage';
import { api, errorMessage } from './api';
import { useTheme } from './useTheme';
import { useToasts } from './useToasts';
import { useLaunches } from './useLaunches';
import type { AccountsState, Page, Profile } from './types';

export default function App() {
  const [page, setPage] = useState<Page>('profiles');
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [accounts, setAccounts] = useState<AccountsState>({ configured: true, activeId: null, accounts: [] });
  const { preference, setPreference } = useTheme();
  const { toasts, pushToast, dismissToast } = useToasts();

  const refreshProfiles = useCallback(() => {
    api.profiles
      .list()
      .then(setProfiles)
      .catch((err) => pushToast(errorMessage(err)));
  }, [pushToast]);

  const launches = useLaunches(pushToast, refreshProfiles);

  useEffect(() => {
    refreshProfiles();
    api.accounts
      .list()
      .then(setAccounts)
      .catch((err) => pushToast(errorMessage(err)));
  }, [refreshProfiles, pushToast]);

  // Accepts a promise from any accounts:* call and applies the resulting state.
  const updateAccounts = useCallback(
    async (pending: Promise<AccountsState | null>) => {
      try {
        const next = await pending;
        if (next) setAccounts(next);
        return next;
      } catch (err) {
        pushToast(errorMessage(err));
        return null;
      }
    },
    [pushToast],
  );

  const login = useCallback(() => updateAccounts(api.accounts.login()), [updateAccounts]);

  const play = async (profile: Profile) => {
    if (!accounts.activeId) {
      const next = await login();
      if (!next?.activeId) return;
    }
    api.game.launch(profile.id).catch((err) => pushToast(errorMessage(err)));
  };

  return (
    <div className="app">
      <Sidebar
        page={page}
        onNavigate={setPage}
        accounts={accounts}
        onLogin={login}
        onSwitchAccount={(id) => updateAccounts(api.accounts.setActive(id))}
        onLogout={(id) => updateAccounts(api.accounts.logout(id))}
      />
      <main className="main">
        {page === 'profiles' && (
          <ProfilesPage
            profiles={profiles}
            launches={launches}
            onCreated={(p) => setProfiles((ps) => [...(ps ?? []), p])}
            onDeleted={(id) => setProfiles((ps) => ps?.filter((p) => p.id !== id) ?? null)}
            onPlay={play}
            onError={pushToast}
          />
        )}
        {page === 'import' && <ImportPage />}
        {page === 'mods' && <ModsPage />}
        {page === 'settings' && <SettingsPage theme={preference} onThemeChange={setPreference} onError={pushToast} />}
      </main>
      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
