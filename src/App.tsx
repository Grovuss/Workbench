import { useCallback, useEffect, useState } from 'react';
import Sidebar from './components/Sidebar';
import TitleBar, { type Crumb } from './components/TitleBar';
import Toasts from './components/Toasts';
import CrashModal from './components/CrashModal';
import ProfilesPage from './pages/ProfilesPage';
import ProfilePage, { type ProfileTab } from './pages/ProfilePage';
import BrowsePage from './pages/BrowsePage';
import SkinsPage from './pages/SkinsPage';
import SettingsPage from './pages/SettingsPage';
import { api, errorMessage } from './api';
import { useTheme } from './useTheme';
import { useToasts } from './useToasts';
import { useLaunches } from './useLaunches';
import type { AccountsState, CrashReport, Page, Profile, QuickPlay, Route } from './types';

const PAGE_TITLES: Record<Page, string> = {
  profiles: 'Profiles',
  browse: 'Browse',
  skins: 'Skins',
  settings: 'Settings',
};

const sameRoute = (a: Route, b: Route) =>
  a.page === b.page && (a.page !== 'profile' || (b.page === 'profile' && a.id === b.id && a.tab === b.tab));

export default function App() {
  const [history, setHistory] = useState<Route[]>([{ page: 'profiles' }]);
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [accounts, setAccounts] = useState<AccountsState>({ configured: true, activeId: null, accounts: [] });
  const [crash, setCrash] = useState<{ profileId: string; report: CrashReport } | null>(null);
  const { preference, setPreference } = useTheme();
  const { toasts, pushToast, dismissToast } = useToasts();
  const route = history[history.length - 1];

  const navigate = useCallback((next: Route) => {
    setHistory((h) => (sameRoute(h[h.length - 1], next) ? h : [...h, next]));
  }, []);
  const back = useCallback(() => setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h)), []);

  // Mouse "back" button.
  useEffect(() => {
    const onMouseUp = (e: MouseEvent) => e.button === 3 && back();
    window.addEventListener('mouseup', onMouseUp);
    return () => window.removeEventListener('mouseup', onMouseUp);
  }, [back]);

  const refreshProfiles = useCallback(() => {
    api.profiles
      .list()
      .then(setProfiles)
      .catch((err) => pushToast(errorMessage(err)));
  }, [pushToast]);

  const onCrash = useCallback((profileId: string, report: CrashReport) => setCrash({ profileId, report }), []);
  const launches = useLaunches(pushToast, refreshProfiles, onCrash);

  const refreshAccounts = useCallback(() => {
    api.accounts
      .list()
      .then(setAccounts)
      .catch((err) => pushToast(errorMessage(err)));
  }, [pushToast]);

  useEffect(() => {
    refreshProfiles();
    refreshAccounts();
  }, [refreshProfiles, refreshAccounts]);

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

  const play = async (profile: Profile, quickPlay?: QuickPlay) => {
    if (!accounts.activeId) {
      const next = await login();
      if (!next?.activeId) return;
    }
    api.game.launch(profile.id, quickPlay).catch((err) => pushToast(errorMessage(err)));
  };

  const stop = (id: string) => api.game.stop(id).catch((err) => pushToast(errorMessage(err)));
  const openProfile = (id: string, tab?: ProfileTab) => navigate({ page: 'profile', id, tab });
  const addProfile = (p: Profile) => {
    setProfiles((ps) => [...(ps ?? []).filter((x) => x.id !== p.id), p]);
    openProfile(p.id);
  };

  const currentProfile = route.page === 'profile' ? profiles?.find((p) => p.id === route.id) : undefined;
  const crashedProfile = crash && profiles?.find((p) => p.id === crash.profileId);

  let crumbs: Crumb[];
  if (route.page === 'profile') {
    crumbs = [
      { label: 'Profiles', onClick: () => navigate({ page: 'profiles' }) },
      { label: currentProfile?.name ?? '…' },
    ];
  } else {
    crumbs = [{ label: PAGE_TITLES[route.page] }];
  }

  return (
    <div className="app">
      <TitleBar
        crumbs={crumbs}
        canGoBack={history.length > 1}
        onBack={back}
        profiles={profiles ?? []}
        launches={launches}
        onOpenProfile={(id) => openProfile(id)}
        onStop={stop}
      />
      <Sidebar
        page={route.page === 'profile' ? 'profiles' : route.page}
        onNavigate={(page) => navigate({ page })}
        accounts={accounts}
        onLogin={login}
        onSwitchAccount={(id) => updateAccounts(api.accounts.setActive(id))}
        onLogout={(id) => updateAccounts(api.accounts.logout(id))}
      />
      <main className="main">
        {route.page === 'profiles' && (
          <ProfilesPage
            profiles={profiles}
            launches={launches}
            onCreated={addProfile}
            onOpen={(id) => openProfile(id)}
            onPlay={(p) => play(p)}
            onStop={stop}
          />
        )}
        {route.page === 'profile' && currentProfile && (
          <ProfilePage
            // A requested tab (from the crash dialog) opens the page fresh on that tab.
            key={`${currentProfile.id}:${route.tab ?? ''}`}
            profile={currentProfile}
            launch={launches[currentProfile.id]}
            initialTab={route.tab as ProfileTab | undefined}
            onPlay={(quickPlay) => play(currentProfile, quickPlay)}
            onStop={() => stop(currentProfile.id)}
            onUpdated={(p) => setProfiles((ps) => ps?.map((x) => (x.id === p.id ? p : x)) ?? null)}
            onDeleted={() => {
              setProfiles((ps) => ps?.filter((x) => x.id !== currentProfile.id) ?? null);
              setHistory([{ page: 'profiles' }]);
            }}
            onDuplicated={(p) => {
              addProfile(p);
              pushToast(`Created “${p.name}”.`, 'success');
            }}
            onError={pushToast}
            onSuccess={(message) => pushToast(message, 'success')}
          />
        )}
        {route.page === 'browse' && <BrowsePage profiles={profiles} onProfileCreated={addProfile} onError={pushToast} />}
        {route.page === 'skins' && <SkinsPage accounts={accounts} onLogin={login} onSkinChanged={refreshAccounts} onError={pushToast} onSuccess={(message) => pushToast(message, 'success')} />}
        {route.page === 'settings' && (
          <SettingsPage theme={preference} onThemeChange={setPreference} onError={pushToast} />
        )}
      </main>
      {crash && crashedProfile && (
        <CrashModal
          profile={crashedProfile}
          report={crash.report}
          onClose={() => setCrash(null)}
          onOpenTab={(tab) => openProfile(crashedProfile.id, tab)}
          onError={pushToast}
        />
      )}
      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
