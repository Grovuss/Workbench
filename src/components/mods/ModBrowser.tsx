import { useEffect, useRef, useState } from 'react';
import { Check, Download, LoaderCircle, Search } from 'lucide-react';
import ModIcon from './ModIcon';
import { api, errorMessage } from '../../api';
import type { InstalledMod, ModSearchHit, Profile } from '../../types';

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

interface Props {
  profile: Profile;
  installed: InstalledMod[];
  onInstalled: (mods: InstalledMod[]) => void;
  onError: (message: string) => void;
}

/** Modrinth search filtered to the profile's loader and game version. */
export default function ModBrowser({ profile, installed, onInstalled, onError }: Props) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<ModSearchHit[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [installing, setInstalling] = useState<Set<string>>(new Set());
  const requestId = useRef(0);

  const installedIds = new Set(installed.map((m) => m.projectId).filter(Boolean));

  // Debounced search; newer requests win over slower older ones.
  useEffect(() => {
    const id = ++requestId.current;
    const timer = window.setTimeout(() => {
      api.mods
        .search(profile.id, { query: query.trim(), offset: 0 })
        .then((res) => {
          if (id !== requestId.current) return;
          setHits(res.hits);
          setTotal(res.total);
        })
        .catch((err) => id === requestId.current && onError(errorMessage(err)));
    }, query ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [profile.id, profile.loader, profile.mcVersion, query, onError]);

  const loadMore = async () => {
    if (!hits) return;
    setLoadingMore(true);
    const id = requestId.current;
    try {
      const res = await api.mods.search(profile.id, { query: query.trim(), offset: hits.length });
      if (id === requestId.current) setHits([...hits, ...res.hits]);
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  };

  const install = async (hit: ModSearchHit) => {
    setInstalling((s) => new Set(s).add(hit.projectId));
    try {
      onInstalled(await api.mods.install(profile.id, hit.projectId));
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setInstalling((s) => {
        const next = new Set(s);
        next.delete(hit.projectId);
        return next;
      });
    }
  };

  return (
    <div className="mod-browser">
      <label className="search-field">
        <Search size={16} />
        <input
          className="input"
          value={query}
          placeholder={`Search Modrinth for ${profile.mcVersion} mods…`}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      </label>

      {hits === null ? (
        <div className="mod-loading">
          <LoaderCircle size={22} className="spin" />
        </div>
      ) : hits.length === 0 ? (
        <p className="mod-empty">No mods found for {profile.mcVersion} on this loader.</p>
      ) : (
        <>
          <div className="mod-list">
            {hits.map((hit) => {
              const isInstalled = installedIds.has(hit.projectId);
              const busy = installing.has(hit.projectId);
              return (
                <div key={hit.projectId} className="mod-row">
                  <ModIcon url={hit.iconUrl} />
                  <div className="mod-info">
                    <div className="mod-title">
                      {hit.title} <span className="mod-author">by {hit.author}</span>
                    </div>
                    <p className="mod-description">{hit.description}</p>
                    <span className="mod-meta">
                      <Download size={12} /> {compact.format(hit.downloads)}
                    </span>
                  </div>
                  {isInstalled ? (
                    <span className="mod-installed">
                      <Check size={15} /> Installed
                    </span>
                  ) : (
                    <button className="btn btn-primary btn-play" onClick={() => install(hit)} disabled={busy}>
                      {busy ? <LoaderCircle size={15} className="spin" /> : <Download size={15} />}
                      {busy ? 'Installing' : 'Install'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {hits.length < total && (
            <button className="btn btn-secondary mod-more" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
