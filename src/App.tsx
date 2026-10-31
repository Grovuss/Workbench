import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import Sidebar from './components/Sidebar';
import TitleBar, { type Crumb } from './components/TitleBar';
import Toasts from './components/Toasts';
import CrashModal from './components/CrashModal';
import CreateProfileModal, { type Mode as CreateMode } from './components/CreateProfileModal';
import Welcome, { type WelcomeChoice } from './components/Welcome';
import ProfilesPage from './pages/ProfilesPage';
import ProfilePage, { type ProfileTab } from './pages/ProfilePage';
import BrowsePage from './pages/BrowsePage';
import SkinsPage from './pages/SkinsPage';
import SettingsPage from './pages/SettingsPage';
import { api, errorMessage } from './api';
import { useAppearance } from './appearance';
import LaunchCheckModal from './components/LaunchCheckModal';
import { hideSplash } from './splash';
import { useUpdateStatus } from './useUpdateStatus';
import { useToasts } from './useToasts';
import { useLaunches } from './useLaunches';
import type { AccountsState, CrashReport, Page, Problem, Profile, QuickPlay, Route } from './types';

const PAGE_TITLES: Record<Page, string> = {
  profiles: 'Profiles',
  browse: 'Browse',
  skins: 'Skins',
  settings: 'Settings',
};

// The mod check never holds up Play for long; if it's slow, the game just starts.
const CHECK_TIMEOUT_MS = 4000;

/** Problems with a profile's mods, if checking is on and finishes in time; otherwise none. */
async function checkMods(profileId: string): Promise<Problem[]> {
  try {
    const { checkModsOnLaunch } = await api.settings.get();
    if (!checkModsOnLaunch) return [];
    const timeout = new Promise<Problem[]>((resolve) => window.setTimeout(() => resolve([]), CHECK_TIMEOUT_MS));
    return await Promise.race([api.diagnose.scan(profileId), timeout]);
  } catch {
    return [];
  }
}

const sameRoute = (a: Route, b: Route) =>
  a.page === b.page && (a.page !== 'profile' || (b.page === 'profile' && a.id === b.id && a.tab === b.tab));

export default function App() {
  const [history, setHistory] = useState<Route[]>([{ page: 'profiles' }]);
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [accounts, setAccounts] = useState<AccountsState>({ configured: true, activeId: null, accounts: [] });
  const [crash, setCrash] = useState<{ profileId: string; report: CrashReport } | null>(null);
  // Create/import opened from outside the Profiles page: the welcome, or a pack opened from Explorer.
  const [creating, setCreating] = useState<{ mode: CreateMode; file?: string } | null>(null);
  const [welcomed, setWelcomed] = useState<boolean | null>(null);
  const [update] = useUpdateStatus();
  const [appearance, setAppearance] = useAppearance();
  // Play was pressed on a profile whose mods have problems.
  const [checking, setChecking] = useState<{ profile: Profile; quickPlay?: QuickPlay; problems: Problem[] } | null>(null);
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

  useEffect(() => {
    api.settings
      .get()
      .then((s) => setWelcomed(s.welcomed))
      .catch(() => setWelcomed(true));
    // A pack double-clicked in Explorer, whether it started Workbench or arrived while it was open.
    api.system
      .takeOpenedFile()
      .then((file) => file && setCreating({ mode: 'import', file }))
      .catch(() => {});
    return api.game.onEvent((event) => {
      if (event.type === 'open-pack') setCreating({ mode: 'import', file: event.path });
    });
  }, []);

  const finishWelcome = (choice: WelcomeChoice) => {
    setWelcomed(true);
    api.settings.set({ welcomed: true }).catch(() => {});
    if (choice === 'browse') navigate({ page: 'browse' });
    if (choice === 'new' || choice === 'import') setCreating({ mode: choice });
  };

  // The splash goes once there's something to show (or loading failed and a toast explains).
  useEffect(() => {
    if (profiles !== null && welcomed !== null) hideSplash();
  }, [profiles, welcomed]);
  useEffect(() => {
    const fallback = window.setTimeout(hideSplash, 5000);
    return () => window.clearTimeout(fallback);
  }, []);

  // Someone who already has profiles (from before the welcome existed) doesn't need it.
  const showWelcome = welcomed === false && profiles !== null && profiles.length === 0;
  useEffect(() => {
    if (welcomed === false && profiles && profiles.length > 0) {
      setWelcomed(true);
      api.settings.set({ welcomed: true }).catch(() => {});
    }
  }, [welcomed, profiles]);

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

  const launch = (profile: Profile, quickPlay?: QuickPlay) =>
    api.game.launch(profile.id, quickPlay).catch((err) => pushToast(errorMessage(err)));

  const play = async (profile: Profile, quickPlay?: QuickPlay) => {
    if (!accounts.activeId) {
      const next = await login();
      if (!next?.activeId) return;
    }
    const problems = profile.loader === 'vanilla' ? [] : await checkMods(profile.id);
    if (problems.length) setChecking({ profile, quickPlay, problems });
    else launch(profile, quickPlay);
  };

  const stop = (id: string) => api.game.stop(id).catch((err) => pushToast(errorMessage(err)));
  const openProfile = (id: string, tab?: ProfileTab) => navigate({ page: 'profile', id, tab });
  const addProfile = (p: Profile) => {
    setProfiles((ps) => [...(ps ?? []).filter((x) => x.id !== p.id), p]);
    openProfile(p.id);
  };

  const currentProfile = route.page === 'profile' ? profiles?.find((p) => p.id === route.id) : undefined;
  const groups = [...new Set((profiles ?? []).map((p) => p.group).filter((g): g is string => Boolean(g)))].sort((a, b) => a.localeCompare(b));
  const pinned = (profiles ?? []).filter((p) => p.pinned).sort((a, b) => a.name.localeCompare(b.name));

  // A profile's cover shows on its page when that's turned on; otherwise the chosen image, if any.
  const coverBackdrop =
    appearance.profileCovers && currentProfile?.cover
      ? `workbench://screenshot/${currentProfile.id}/${encodeURIComponent(currentProfile.cover)}`
      : null;
  const backdrop = coverBackdrop ?? (appearance.background ? `workbench://background/?v=${appearance.background}` : null);
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
      {backdrop && (
        <div
          className="app-backdrop"
          data-blur={appearance.backgroundBlur || undefined}
          style={{ '--backdrop-image': `url("${backdrop}")`, '--backdrop-dim': appearance.backgroundDim } as CSSProperties}
          aria-hidden
        />
      )}
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
        update={update}
        onInstallUpdate={() => api.updates.install().catch((err) => pushToast(errorMessage(err)))}
        pinned={pinned}
        currentProfileId={currentProfile?.id ?? null}
        launches={launches}
        onOpenProfile={(id) => openProfile(id)}
        onPlay={(p) => play(p)}
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
            onProfilesChanged={setProfiles}
            onError={pushToast}
          />
        )}
        {route.page === 'profile' && currentProfile && (
          <ProfilePage
            // A requested tab (from the crash dialog) opens the page fresh on that tab.
            key={`${currentProfile.id}:${route.tab ?? ''}`}
            profile={currentProfile}
            launch={launches[currentProfile.id]}
            groups={groups}
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
          <SettingsPage appearance={appearance} onAppearanceChange={setAppearance} onError={pushToast} />
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
      {checking && (
        <LaunchCheckModal
          profile={checking.profile}
          problems={checking.problems}
          onLaunch={() => {
            setChecking(null);
            launch(checking.profile, checking.quickPlay);
          }}
          onClose={() => setChecking(null)}
          onOpenTab={(tab) => openProfile(checking.profile.id, tab)}
          onError={pushToast}
        />
      )}
      {creating && (
        <CreateProfileModal
          // A second pack opened from Explorer starts a fresh import.
          key={creating.file ?? creating.mode}
          initialMode={creating.mode}
          initialFile={creating.file}
          onClose={() => setCreating(null)}
          onCreated={addProfile}
        />
      )}
      {showWelcome && (
        <Welcome accounts={accounts} onLogin={login} theme={appearance.theme} onThemeChange={(theme) => setAppearance({ theme })} onDone={finishWelcome} />
      )}
      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
