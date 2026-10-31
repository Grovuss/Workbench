export type Page = 'profiles' | 'browse' | 'settings';

export type ContentKind = 'mod' | 'resourcepack' | 'shader' | 'datapack';

/** Where content lives: a profile's mods/resourcepacks/shaderpacks, or a world's datapacks. */
export interface ContentTarget {
  profileId: string;
  kind: ContentKind;
  /** World folder name; data packs only. */
  world?: string;
}

export interface InstalledContent {
  /** File name in the content folder, without a ".disabled" suffix. */
  fileName: string;
  enabled: boolean;
  size: number;
  title: string;
  versionNumber: string | null;
  /** Modrinth project, when the file was identified. */
  projectId: string | null;
  iconUrl: string | null;
  /** Version number of an available update, from the last update check. */
  updateVersion: string | null;
}

export interface ContentSearchHit {
  projectId: string;
  title: string;
  description: string;
  author: string;
  iconUrl: string | null;
  downloads: number;
}

export interface ContentSearchResult {
  total: number;
  hits: ContentSearchHit[];
}

export type PackKind = 'workbench' | 'mrpack' | 'curseforge';

/** A pack file Workbench couldn't download, with the page to get it from. */
export interface MissingPackFile {
  name: string;
  fileName: string;
  url: string;
  /** 'author': the author doesn't allow launchers to download it; 'unsupported': not a mod, resource pack or shader. */
  reason: 'author' | 'unsupported';
}

export interface ImportResult {
  profile: Profile;
  missing: MissingPackFile[];
}

/** Extra profile folders/files a .workbench export can include. */
export type ExportItem = 'config' | 'resourcepacks' | 'shaderpacks' | 'options.txt' | 'saves';

export interface ImportProgress {
  label: string;
  done: number;
  total: number;
}

export type Route = { page: Page } | { page: 'profile'; id: string };

export type ProfileFolder = 'saves' | 'screenshots' | 'logs' | 'resourcepacks' | 'shaderpacks' | 'mods';

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
  /** Whether a CurseForge API key is configured. */
  curseforge: boolean;
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
  content: {
    list(target: ContentTarget): Promise<InstalledContent[]>;
    openFolder(target: ContentTarget): Promise<void>;
    search(target: ContentTarget, query: { query: string; offset: number }): Promise<ContentSearchResult>;
    /** Installs the newest compatible version (plus required dependencies for mods). */
    install(target: ContentTarget, projectId: string): Promise<InstalledContent[]>;
    /** Asks Modrinth for newer compatible versions; fills in `updateVersion`. */
    checkUpdates(target: ContentTarget): Promise<InstalledContent[]>;
    /** Copies .jar/.zip files from disk into the target folder. */
    addFiles(target: ContentTarget, filePaths: string[]): Promise<InstalledContent[]>;
    /** Updates the given files, or every file with an update when fileNames is omitted. */
    update(target: ContentTarget, fileNames?: string[]): Promise<InstalledContent[]>;
    remove(target: ContentTarget, fileName: string): Promise<InstalledContent[]>;
    setEnabled(target: ContentTarget, fileName: string, enabled: boolean): Promise<InstalledContent[]>;
  };
  packs: {
    /** Opens a file picker; resolves to the new profile, or null if cancelled. */
    import(kind?: PackKind): Promise<ImportResult | null>;
    importFile(filePath: string): Promise<ImportResult>;
    /** Opens a save dialog; resolves to the written path, or null if cancelled. */
    export(profileId: string, include: ExportItem[]): Promise<string | null>;
  };
  /** Absolute path of a file dropped onto the window. */
  pathForFile(file: File): string;
  system: {
    info(): Promise<SystemInfo>;
    openDataFolder(): Promise<void>;
    openCurseForge(url: string): Promise<void>;
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
