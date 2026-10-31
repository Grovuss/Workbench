export type Page = 'profiles' | 'import' | 'mods' | 'settings';

export type ThemePreference = 'light' | 'dark' | 'system';

export type Loader = 'vanilla';

export interface Profile {
  id: string;
  name: string;
  loader: Loader;
  mcVersion: string;
  createdAt: string;
  lastPlayedAt: string | null;
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
  stage: 'java' | 'files' | 'assets';
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
  | { type: 'profiles-changed' };

export interface WorkbenchApi {
  platform: string;
  profiles: {
    list(): Promise<Profile[]>;
    create(input: { name: string; mcVersion: string }): Promise<Profile>;
    delete(id: string): Promise<void>;
    openFolder(id: string): Promise<void>;
  };
  versions: {
    list(): Promise<McVersion[]>;
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
  system: {
    info(): Promise<SystemInfo>;
    openDataFolder(): Promise<void>;
  };
}

declare global {
  interface Window {
    workbench: WorkbenchApi;
  }
}
