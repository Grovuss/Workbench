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

export interface InstallManyResult {
  items: InstalledContent[];
  installed: string[];
  skipped: { projectId: string; reason: string }[];
}

export interface PerformanceMod {
  projectId: string;
  title: string;
  iconUrl: string | null;
  /** What it does, in a sentence. */
  about: string;
  installed: boolean;
}

export interface ModSetEntry {
  projectId: string;
  kind: 'mod' | 'resourcepack' | 'shader';
  title: string;
  iconUrl: string | null;
}

export interface ModSet {
  id: string;
  name: string;
  entries: ModSetEntry[];
  createdAt: string;
}

export interface ConfigFile {
  /** Relative to the profile folder, like "config/sodium-options.json". */
  path: string;
  size: number;
  modifiedAt: string;
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
  /** The name shown in game (level.dat), or the folder name. */
  name: string;
  lastPlayedAt: string;
  gameMode: 'survival' | 'creative' | 'adventure' | 'spectator' | null;
  hardcore: boolean;
  /** Minecraft version it was last played in. */
  version: string | null;
  sizeBytes: number;
  /** data: URL of the world's icon.png, if it has one. */
  icon: string | null;
  backupCount: number;
  lastBackupAt: string | null;
}

export interface WorldBackup {
  id: string;
  /** auto: after playing · manual · restore: taken before restoring another · update: before a modpack update */
  kind: 'auto' | 'manual' | 'restore' | 'update';
  createdAt: string;
  sizeBytes: number;
}

export interface ModpackUpdate {
  current: { versionId: string; versionNumber: string };
  latest: {
    versionId: string;
    versionNumber: string;
    date: string;
    gameVersions: string[];
    changelog: string;
    /** Versions between the current one and this. */
    newerCount: number;
  } | null;
}

export interface SharePreview {
  name: string;
  mcVersion: string;
  loader: Loader;
  loaderVersion: string | null;
  counts: Record<'mod' | 'resourcepack' | 'shader', number>;
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
/** A profile's own game settings; null means it uses the one from Settings. */
export interface ProfileSettings {
  memoryMb: number | null;
  jvmArgs: string;
  resolution: Resolution | null;
  fullscreen: boolean | null;
  /** An empty string runs nothing for this profile, even if Settings has a command. */
  preLaunchCommand: string | null;
  postExitCommand: string | null;
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
  /** A folder on the profiles page; null when it isn’t in one. */
  group: string | null;
  /** Shown in the sidebar for quick access. */
  pinned: boolean;
  /** The Modrinth modpack this profile was installed from. */
  pack: { projectId: string; versionId: string; versionNumber: string; title: string } | null;
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

export type LauncherOnLaunch = 'keep' | 'minimize' | 'hide';

export interface Settings {
  welcomed: boolean;
  memoryMb: number;
  /** Added before each profile's own Java arguments. */
  jvmArgs: string;
  /** Window size for profiles without their own; null is the game's default. */
  resolution: Resolution | null;
  fullscreen: boolean;
  /** Look over the mods when Play is pressed, and ask first if something’s wrong. */
  checkModsOnLaunch: boolean;
  onLaunch: LauncherOnLaunch;
  preLaunchCommand: string;
  postExitCommand: string;
  autoBackup: boolean;
  backupsToKeep: number;
  discordPresence: boolean;
  discordShowProfile: boolean;
  shareOptions: boolean;
  downloadThreads: number;
}

/** Bytes used in the data folder. */
export interface StorageUsage {
  profiles: number;
  backups: number;
  java: number;
  shared: number;
}

export interface SystemInfo {
  totalMemoryMb: number;
  dataDir: string;
  /** Whether a CurseForge API key is configured. */
  curseforge: boolean;
  /** Whether a Discord application id is configured, for Rich Presence. */
  discord: boolean;
  version: string;
  os: string;
  electron: string;
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
  | { type: 'crash'; profileId: string; report: CrashReport }
  | { type: 'worlds-backed-up'; profileId: string; count: number }
  | { type: 'open-pack'; path: string }
  | ({ type: 'update' } & UpdateStatus);

export interface UpdateStatus {
  state: 'unsupported' | 'idle' | 'checking' | 'downloading' | 'ready' | 'latest' | 'error';
  version?: string;
  percent?: number;
  message?: string;
}

export interface WorkbenchApi {
  platform: string;
  profiles: {
    list(): Promise<Profile[]>;
    /** Moves a profile into a group (null for none) and/or pins it to the sidebar. */
    organize(id: string, patch: { group?: string | null; pinned?: boolean }): Promise<Profile>;
    /** Renames a group on every profile in it; null ungroups them. Resolves to all profiles. */
    renameGroup(from: string, to: string | null): Promise<Profile[]>;
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
  modSets: {
    list(): Promise<ModSet[]>;
    create(name: string, entries: ModSetEntry[]): Promise<ModSet[]>;
    update(id: string, patch: { name?: string; entries?: ModSetEntry[] }): Promise<ModSet[]>;
    remove(id: string): Promise<ModSet[]>;
  };
  configs: {
    list(profileId: string): Promise<ConfigFile[]>;
    read(profileId: string, path: string): Promise<{ text: string; modifiedAt: number }>;
    /** Doesn't write (returns conflict) if the file changed on disk since it was read, unless forced. */
    write(profileId: string, path: string, text: string, baseModifiedAt: number | null, force?: boolean): Promise<{ conflict: boolean; modifiedAt?: number }>;
    reveal(profileId: string, path: string): Promise<void>;
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
    /** For profiles installed from a Modrinth modpack; null for other profiles. */
    checkUpdate(profileId: string): Promise<ModpackUpdate | null>;
    /** Resolves to the updated profile and config files kept because the player edited them. */
    update(profileId: string, versionId: string): Promise<{ profile: Profile; kept: string[] }>;
  };
  worlds: {
    rename(profileId: string, folder: string, name: string): Promise<World[]>;
    /** Copies into the same profile (as "… (copy)") or another one. Resolves to the source profile's worlds. */
    copy(profileId: string, folder: string, targetProfileId?: string): Promise<World[]>;
    move(profileId: string, folder: string, targetProfileId: string): Promise<World[]>;
    /** Sends the world to the Recycle Bin. */
    remove(profileId: string, folder: string): Promise<World[]>;
    /** Opens a picker for a world folder or .zip; null if cancelled. */
    import(profileId: string, kind: 'folder' | 'zip'): Promise<World[] | null>;
    importPath(profileId: string, filePath: string): Promise<World[]>;
    backups(profileId: string, folder: string): Promise<WorldBackup[]>;
    backup(profileId: string, folder: string): Promise<WorldBackup[]>;
    /** Backs up the world as it is now, then puts the backup in its place. */
    restore(profileId: string, folder: string, backupId: string): Promise<WorldBackup[]>;
    removeBackup(profileId: string, folder: string, backupId: string): Promise<WorldBackup[]>;
    revealBackups(profileId: string, folder: string): Promise<void>;
  };
  share: {
    /** skipped: titles of files that aren't on Modrinth, so can't be in a code. */
    create(profileId: string): Promise<{ code: string; included: number; skipped: string[] }>;
    preview(code: string): Promise<SharePreview>;
    /** failed: how many files couldn't be downloaded. */
    import(code: string): Promise<{ profile: Profile; failed: number }>;
  };
  serverPack: {
    /** Asks where to put it; null if cancelled. */
    export(profileId: string): Promise<{ folder: string; modCount: number; clientOnly: string[] } | null>;
  };
  logs: {
    /** Uploads to mclo.gs; resolves to the link. */
    upload(text: string): Promise<string>;
    open(url: string): Promise<void>;
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
    reset(): Promise<Settings>;
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
    /** Installs several projects at once; ones with no version for the profile come back in `skipped`. */
    installMany(target: ContentTarget, projectIds: string[]): Promise<InstallManyResult>;
    /** Well-known performance mods available for the profile. */
    performance(profileId: string): Promise<PerformanceMod[]>;
    /** Versions that work on the target, newest first. */
    versions(target: ContentTarget, projectId: string): Promise<ContentVersion[]>;
    /** A project's full Modrinth page: description, gallery, links. */
    project(projectId: string): Promise<ProjectDetails>;
    /** Every version of a project, newest first; `fits` says which work on the target, when given. */
    allVersions(projectId: string, target?: ContentTarget): Promise<ProjectVersion[]>;
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
    /** Opens an https link in the browser. */
    openLink(url: string): Promise<void>;
    usage(): Promise<StorageUsage>;
    /** Deletes the downloaded Java runtimes so the next launch fetches them fresh. */
    openCurseForge(url: string): Promise<void>;
    removeJava(): Promise<void>;
    /** A pack file Workbench was opened with, before the window was ready; null after the first call. */
    takeOpenedFile(): Promise<string | null>;
  };
  updates: {
    status(): Promise<UpdateStatus>;
    check(): Promise<UpdateStatus>;
    /** Restarts into a downloaded update. */
    install(): Promise<void>;
  };
  window: {
    /** Title bar colours, window background and zoom; remembered for the next start. */
    setLook(look: WindowLook): Promise<void>;
  };
  appearance: {
    /** Opens a picker and stores the image; resolves to its version, or null if cancelled. */
    pickBackground(): Promise<string | null>;
    removeBackground(): Promise<void>;
  };
}

export interface WindowLook {
  dark: boolean;
  /** #rrggbb */
  background: string;
  sidebar: string;
  text: string;
  zoom: number;
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

/** A Modrinth project's page, for the details view. */
export interface ProjectDetails {
  projectId: string;
  slug: string;
  type: string;
  title: string;
  description: string;
  /** Markdown, often with images and some HTML. */
  body: string;
  author: string | null;
  iconUrl: string | null;
  downloads: number;
  follows: number;
  publishedAt: string;
  updatedAt: string;
  categories: string[];
  loaders: string[];
  gameVersions: string[];
  clientSide: 'required' | 'optional' | 'unsupported' | 'unknown';
  serverSide: 'required' | 'optional' | 'unsupported' | 'unknown';
  license: { id: string; name: string; url: string | null } | null;
  /** url is a preview; fullUrl the original image. */
  gallery: { url: string; fullUrl: string; title: string | null; description: string | null }[];
  links: { modrinth: string; source: string | null; issues: string | null; wiki: string | null; discord: string | null };
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
  loaders: string[];
  /** Markdown. */
  changelog: string;
}

export interface ProjectVersion extends ContentVersion {
  /** Whether it works on the profile the page was opened from; null when there isn't one. */
  fits: boolean | null;
}
