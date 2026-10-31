export type Page = 'profiles' | 'mods' | 'settings';

export interface InstalledMod {
  /** File name in mods/, without a ".disabled" suffix. */
  fileName: string;
  enabled: boolean;
  size: number;
  title: string;
  versionNumber: string | null;
  /** Modrinth project, when the jar was identified. */
  projectId: string | null;
  iconUrl: string | null;
}

export interface ModSearchHit {
  projectId: string;
  title: string;
  description: string;
  author: string;
  iconUrl: string | null;
  downloads: number;
}

export interface ModSearchResult {
  total: number;
  hits: ModSearchHit[];
}

export type PackKind = 'workbench' | 'mrpack';

/** Extra profile folders/files a .workbench export can include. */
export type ExportItem = 'config' | 'resourcepacks' | 'shaderpacks' | 'options.txt' | 'saves';

export interface ImportProgress {
  label: string;
  done: number;
  total: number;
}

export type Route = { page: Page } | { page: 'profile'; id: string };

export type ProfileFolder = 'saves' | 'screenshots' | 'logs' | 'resourcepacks' | 'mods';

export interface World {
  folder: string;
  lastPlayedAt: string;
  /** data: URL of the world's icon.png, if it has one. */
  icon: string | null;
}

export type ThemePreference = 'light' | 'dark' | 'system';

export type Loader = 'vanilla' | 'fabric' | 'quilt' | 'forge' | 'neoforge';
export type ModLoader = Exclude<Loader, 'vanilla'>;

export interface VersionSelection {
  mcVersion: string;
  loader: Loader;
  loaderVersion: string | null;
}

export interface Resolution {
  width: number;
  height: number;
}

/** Per-profile overrides; null/empty means "use the global setting". */
export interface ProfileSettings {
  memoryMb: number | null;
  jvmArgs: string;
  resolution: Resolution | null;
}

export interface Profile extends VersionSelection {
  id: string;
  name: string;
  settings: ProfileSettings;
  createdAt: string;
  lastPlayedAt: string | null;
  /** When the custom icon was last set (used to refresh it), or null for the default. */
  icon: string | null;
  playtimeMs: number;
}

export interface LoaderVersion {
  version: string;
  stable: boolean;
  /** Forge's "recommended" build for this Minecraft version. */
  recommended?: boolean;
}

export interface McVersion {
  id: string;
  type: 'release' | 'snapshot';
  releaseTime: string;
}

export interface Account {
  id: string;
  name: string;
  skinUrl: string | null;
  /** Dev-build offline account (no Microsoft sign-in). */
  offline: boolean;
}

export interface AccountsState {
  configured: boolean;
  activeId: string | null;
  accounts: Account[];
}

export interface Settings {
  memoryMb: number;
}

export interface SystemInfo {
  totalMemoryMb: number;
  dataDir: string;
}

export type GameState = 'idle' | 'installing' | 'running';

export interface Progress {
  stage: 'java' | 'loader' | 'files' | 'assets';
  label: string;
  done: number;
  total: number;
}

export interface LaunchStatus {
  state: Exclude<GameState, 'idle'>;
  progress?: Progress;
}

export type GameEvent =
  | { type: 'state'; profileId: string; state: GameState }
  | ({ type: 'progress'; profileId: string } & Progress)
  | { type: 'error'; profileId: string; message: string }
  | { type: 'profiles-changed' }
  | ({ type: 'import-progress' } & ImportProgress);

export interface WorkbenchApi {
  platform: string;
  profiles: {
    list(): Promise<Profile[]>;
    create(input: { name: string } & VersionSelection): Promise<Profile>;
    setVersion(id: string, selection: VersionSelection): Promise<Profile>;
    updateSettings(id: string, patch: Partial<ProfileSettings>): Promise<Profile>;
    delete(id: string): Promise<void>;
    rename(id: string, name: string): Promise<Profile>;
    worlds(id: string): Promise<World[]>;
    /** Tail of the last launch log, or null if never launched. */
    readLog(id: string): Promise<string | null>;
    openFolder(id: string, sub?: ProfileFolder): Promise<void>;
    /** Opens an image picker; resolves to the updated profile, or null if cancelled. */
    setIcon(id: string): Promise<Profile | null>;
    removeIcon(id: string): Promise<Profile>;
  };
  versions: {
    list(): Promise<McVersion[]>;
  };
  loaders: {
    /** Minecraft versions the loader supports. */
    games(loader: ModLoader): Promise<string[]>;
    versions(loader: ModLoader, mcVersion: string): Promise<LoaderVersion[]>;
  };
  accounts: {
    list(): Promise<AccountsState>;
    /** Resolves to null if the sign-in window was closed. */
    login(): Promise<AccountsState | null>;
    logout(id: string): Promise<AccountsState>;
    setActive(id: string): Promise<AccountsState>;
  };
  game: {
    launch(profileId: string): Promise<void>;
    stop(profileId: string): Promise<void>;
    status(): Promise<Record<string, Exclude<GameState, 'idle'>>>;
    onEvent(callback: (event: GameEvent) => void): () => void;
  };
  settings: {
    get(): Promise<Settings>;
    set(patch: Partial<Settings>): Promise<Settings>;
  };
  mods: {
    list(profileId: string): Promise<InstalledMod[]>;
    search(profileId: string, query: { query: string; offset: number }): Promise<ModSearchResult>;
    /** Installs the newest compatible version plus required dependencies. */
    install(profileId: string, projectId: string): Promise<InstalledMod[]>;
    remove(profileId: string, fileName: string): Promise<InstalledMod[]>;
    setEnabled(profileId: string, fileName: string, enabled: boolean): Promise<InstalledMod[]>;
  };
  packs: {
    /** Opens a file picker; resolves to the new profile, or null if cancelled. */
    import(kind?: PackKind): Promise<Profile | null>;
    importFile(filePath: string): Promise<Profile>;
    /** Opens a save dialog; resolves to the written path, or null if cancelled. */
    export(profileId: string, include: ExportItem[]): Promise<string | null>;
    pathForFile(file: File): string;
  };
  system: {
    info(): Promise<SystemInfo>;
    openDataFolder(): Promise<void>;
  };
  window: {
    setTheme(dark: boolean): Promise<void>;
  };
}

declare global {
  interface Window {
    workbench: WorkbenchApi;
  }
}
