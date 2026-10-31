export type Page = 'profiles' | 'browse' | 'skins' | 'settings';

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
  /** Modrinth version id, when identified. */
  versionId: string | null;
  /** Modrinth project, when the file was identified. */
  projectId: string | null;
  iconUrl: string | null;
  /** Version number of an available update, from the last update check. */
  updateVersion: string | null;
  /** When the file was added to the folder. */
  addedAt: string;
}

export interface ContentSearchHit {
  projectId: string;
  kind: ContentKind;
  title: string;
  description: string;
  author: string;
  iconUrl: string | null;
  downloads: number;
  follows: number;
  updatedAt: string;
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

/** `tab` opens a profile on a specific tab (see ProfileTab). */
export type Route = { page: Page } | { page: 'profile'; id: string; tab?: string };

export type ProfileFolder = 'saves' | 'screenshots' | 'logs' | 'resourcepacks' | 'shaderpacks' | 'mods' | 'crash-reports';

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
  /** A screenshot's file name, shown on the profile's card in the grid view. */
  cover: string | null;
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
  | ({ type: 'import-progress' } & ImportProgress)
  | { type: 'crash'; profileId: string; report: CrashReport };

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
    /** Copies the profile's folder and settings into a new profile. */
    duplicate(id: string, name?: string): Promise<Profile>;
  };
  screenshots: {
    list(profileId: string): Promise<Screenshot[]>;
    remove(profileId: string, fileName: string): Promise<Screenshot[]>;
    setCover(profileId: string, fileName: string | null): Promise<Profile>;
    copy(profileId: string, fileName: string): Promise<void>;
    reveal(profileId: string, fileName: string): Promise<void>;
  };
  diagnose: {
    /** Problems with the profile's enabled mods, read from their metadata. */
    scan(profileId: string): Promise<Problem[]>;
    /** Finds a mod on Modrinth by its mod id and installs it. */
    installDependency(profileId: string, modId: string): Promise<InstalledContent[]>;
    openCrashReport(profileId: string, fileName: string): Promise<void>;
  };
  skins: {
    state(): Promise<SkinState>;
    /** Back to the default skin. */
    reset(): Promise<SkinState>;
    /** null hides the cape. */
    setCape(capeId: string | null): Promise<SkinState>;
    /** Uploads a library skin as the account's skin. */
    wear(id: string): Promise<SkinState>;
    library(): Promise<LibrarySkin[]>;
    /** Opens a file picker; null if cancelled. */
    pick(): Promise<LibrarySkin[] | null>;
    addFiles(filePaths: string[]): Promise<LibrarySkin[]>;
    saveCurrent(): Promise<LibrarySkin[]>;
    update(id: string, patch: { name?: string; variant?: SkinVariant }): Promise<LibrarySkin[]>;
    remove(id: string): Promise<LibrarySkin[]>;
  };
  modpacks: {
    search(options: ModpackSearchOptions): Promise<{ total: number; hits: ModpackHit[] }>;
    versions(projectId: string): Promise<ModpackVersion[]>;
    /** Installs a version (the newest release by default) as a new profile. */
    install(projectId: string, versionId?: string): Promise<ImportResult>;
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
    /** `quickPlay` joins a server or opens a world (1.20+) as the game starts. */
    launch(profileId: string, quickPlay?: QuickPlay): Promise<void>;
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
    search(target: ContentTarget, options: SearchOptions): Promise<ContentSearchResult>;
    /** Mods, resource packs and shaders at once, whichever the profile can use. */
    searchAll(profileId: string, options: SearchOptions): Promise<ContentSearchResult>;
    categories(kind: ContentKind | 'modpack'): Promise<ContentCategory[]>;
    /** Installs a version (the newest compatible one by default) plus required dependencies for mods. Replaces any other installed version. */
    install(target: ContentTarget, projectId: string, versionId?: string): Promise<InstalledContent[]>;
    /** Versions that work on the target, newest first. */
    versions(target: ContentTarget, projectId: string): Promise<ContentVersion[]>;
    /** Asks Modrinth for newer compatible versions; fills in `updateVersion`. */
    checkUpdates(target: ContentTarget): Promise<InstalledContent[]>;
    /** Changelogs between the installed version and its update. */
    changelog(target: ContentTarget, fileName: string): Promise<Changelog>;
    /** Copies .jar/.zip files from disk into the target folder. */
    addFiles(target: ContentTarget, filePaths: string[]): Promise<InstalledContent[]>;
    /** Copies files of any kind into a profile, sorted by what they are. Resolves to counts per kind. */
    addAny(profileId: string, filePaths: string[]): Promise<Partial<Record<ContentKind, number>>>;
    /** Opens a file picker, then adds like addAny (or into `target`, for data packs); null if cancelled. */
    pickFiles(profileId: string, target?: ContentTarget): Promise<Partial<Record<ContentKind, number>> | null>;
    /** Updates the given files, or every file with an update when fileNames is omitted. */
    update(target: ContentTarget, fileNames?: string[]): Promise<InstalledContent[]>;
    remove(target: ContentTarget, fileName: string): Promise<InstalledContent[]>;
    setEnabled(target: ContentTarget, fileName: string, enabled: boolean): Promise<InstalledContent[]>;
  };
  servers: {
    list(profileId: string): Promise<Server[]>;
    add(profileId: string, input: ServerInput): Promise<Server[]>;
    update(profileId: string, index: number, input: ServerInput): Promise<Server[]>;
    remove(profileId: string, index: number): Promise<Server[]>;
    ping(address: string): Promise<ServerStatus>;
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

export type ContentSort = 'relevance' | 'downloads' | 'follows' | 'newest' | 'updated';

export interface SearchOptions {
  query: string;
  offset: number;
  sort?: ContentSort;
  /** A Modrinth category name, e.g. "optimization". */
  category?: string;
}

export interface ContentCategory {
  name: string;
  /** Group, e.g. "categories", "features", "resolutions", "performance impact". */
  header: string;
}

export type QuickPlay = { server: string } | { world: string };

export interface Server {
  /** Position in servers.dat; pass back to update/remove. */
  index: number;
  name: string;
  address: string;
  icon: string | null;
}

export interface ServerInput {
  name: string;
  address: string;
}

export interface ServerStatus {
  latencyMs: number;
  version: string | null;
  players: { online: number; max: number } | null;
  motd: string;
  icon: string | null;
}

export type ProblemFix =
  | { type: 'disable'; fileName: string; label: string }
  | { type: 'install'; modId: string; label: string }
  | { type: 'settings'; label: string };

/** A mod problem found ahead of time, or a likely cause of a crash. */
export interface Problem {
  id: string;
  message: string;
  /** Mod files involved. */
  files: string[];
  fixes: ProblemFix[];
}

export interface CrashReport {
  exitCode: number | null;
  problems: Problem[];
  /** File name in crash-reports/, if the game wrote one. */
  crashReport: string | null;
}

export interface Screenshot {
  fileName: string;
  takenAt: string;
  size: number;
}

export type SkinVariant = 'classic' | 'slim';

export interface Cape {
  id: string;
  alias: string;
  url: string;
  active: boolean;
}

export interface SkinState {
  account: { id: string; name: string };
  /** null when wearing a default skin. */
  skin: { url: string; variant: SkinVariant } | null;
  capes: Cape[];
}

export interface LibrarySkin {
  id: string;
  name: string;
  variant: SkinVariant;
  addedAt: string;
}

export interface ChangelogEntry {
  versionNumber: string;
  type: 'release' | 'beta' | 'alpha';
  date: string;
  /** Markdown. */
  changelog: string;
}

export interface Changelog {
  title: string;
  from: string | null;
  to: string | null;
  entries: ChangelogEntry[];
  /** Versions left out of `entries`. */
  more: number;
}

export interface ModpackSearchOptions extends SearchOptions {
  loader?: ModLoader;
  gameVersion?: string;
}

export interface ModpackHit {
  projectId: string;
  title: string;
  description: string;
  author: string;
  iconUrl: string | null;
  downloads: number;
  follows: number;
  updatedAt: string;
  loaders: ModLoader[];
  gameVersions: string[];
}

export interface ModpackVersion {
  id: string;
  name: string;
  versionNumber: string;
  type: 'release' | 'beta' | 'alpha';
  gameVersions: string[];
  loaders: string[];
  date: string;
}

export interface ContentVersion {
  id: string;
  name: string;
  versionNumber: string;
  type: 'release' | 'beta' | 'alpha';
  date: string;
  downloads: number;
  gameVersions: string[];
  /** Markdown. */
  changelog: string;
}
