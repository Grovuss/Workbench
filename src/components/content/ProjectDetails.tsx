import { useEffect, useState, type ReactNode } from 'react';
import { BookOpen, Bug, ChevronLeft, ChevronRight, Code2, Download, ExternalLink, Heart, LoaderCircle, MessageCircle, X } from 'lucide-react';
import ContentIcon from './ContentIcon';
import ProjectVersions from './ProjectVersions';
import Markdown from '../Markdown';
import { api, errorMessage } from '../../api';
import { categoryLabel } from '../../content';
import { timeAgo } from '../../time';
import type { ContentTarget, InstalledContent, ProjectDetails as Details } from '../../types';
import { formatCount } from '../../format';
import { versionRange } from './versionSort';

const SIDE_LABELS: Record<Details['clientSide'], string> = {
  required: 'Required',
  optional: 'Optional',
  unsupported: 'Not needed',
  unknown: 'Unknown',
};

/** What the list already knows, shown while the full page loads. */
export interface ProjectPreview {
  projectId: string;
  title: string;
  description: string;
  author?: string | null;
  iconUrl: string | null;
}

interface Props {
  project: ProjectPreview;
  /** Install, or whatever fits where it was opened from. */
  actions?: ReactNode;
  /** Where the project would be installed; lets the Versions tab show what fits and install a chosen one. */
  target?: ContentTarget;
  /** The version already installed there, if any. */
  installedVersionId?: string | null;
  onInstalled?: (items: InstalledContent[]) => void;
  onClose: () => void;
}

/** A Modrinth project's page inside the launcher: description, gallery and the details that matter before installing. */
export default function ProjectDetails({ project, actions, target, installedVersionId, onInstalled, onClose }: Props) {
  const [details, setDetails] = useState<Details | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'about' | 'versions' | 'gallery'>('about');
  const [viewing, setViewing] = useState<number | null>(null);

  useEffect(() => {
    api.content
      .project(project.projectId)
      .then(setDetails)
      .catch((err) => setError(errorMessage(err)));
  }, [project.projectId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (viewing !== null) setViewing(null);
      else onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [viewing, onClose]);

  const gallery = details?.gallery ?? [];
  const author = details?.author ?? project.author;
  const open = (url: string) => api.system.openLink(url).catch(() => {});

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal project" role="dialog" aria-modal="true" aria-labelledby="project-title">
        <header className="project-head">
          <ContentIcon url={details?.iconUrl ?? project.iconUrl} size={72} />
          <div className="project-head-info">
            <h2 id="project-title">{details?.title ?? project.title}</h2>
            {author && <div className="project-author">by {author}</div>}
            <p>{details?.description ?? project.description}</p>
            {details && (
              <div className="project-stats">
                <span>
                  <Download size={14} /> {formatCount(details.downloads)} downloads
                </span>
                <span>
                  <Heart size={14} /> {formatCount(details.follows)} followers
                </span>
                <span>Updated {timeAgo(details.updatedAt)}</span>
              </div>
            )}
          </div>
          <div className="project-head-actions">
            {actions}
            <button className="icon-btn" aria-label="Close" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="tabs project-tabs" role="tablist">
          <button role="tab" className="tab" aria-selected={tab === 'about'} onClick={() => setTab('about')}>
            Description
          </button>
          <button role="tab" className="tab" aria-selected={tab === 'versions'} onClick={() => setTab('versions')}>
            Versions
          </button>
          {gallery.length > 0 && (
            <button role="tab" className="tab" aria-selected={tab === 'gallery'} onClick={() => setTab('gallery')}>
              Gallery <span className="chip-count">{gallery.length}</span>
            </button>
          )}
        </div>

        <div className="project-body">
          <div className="project-main">
            {tab === 'versions' ? (
              <ProjectVersions
                projectId={project.projectId}
                target={target}
                installedVersionId={installedVersionId}
                onInstalled={onInstalled}
              />
            ) : error ? (
              <p className="mod-empty">Couldn’t load this project’s page. {error}</p>
            ) : !details ? (
              <div className="mod-loading">
                <LoaderCircle size={22} className="spin" />
              </div>
            ) : tab === 'gallery' ? (
              <div className="project-gallery">
                {gallery.map((image, i) => (
                  <button key={image.url} className="project-gallery-item" onClick={() => setViewing(i)}>
                    <img src={image.url} alt={image.title ?? ''} loading="lazy" referrerPolicy="no-referrer" />
                    {image.title && <span>{image.title}</span>}
                  </button>
                ))}
              </div>
            ) : details.body.trim() ? (
              <Markdown text={details.body} />
            ) : (
              <p className="mod-empty">No description yet.</p>
            )}
          </div>

          {details && (
            <aside className="project-side">
              {details.categories.length > 0 && (
                <section>
                  <h3>Categories</h3>
                  <div className="project-tags">
                    {details.categories.map((c) => (
                      <span key={c} className="kind-tag">
                        {categoryLabel(c)}
                      </span>
                    ))}
                  </div>
                </section>
              )}
              {details.type === 'mod' && (
                <section>
                  <h3>Where it runs</h3>
                  <dl className="project-facts">
                    <dt>Client</dt>
                    <dd>{SIDE_LABELS[details.clientSide] ?? 'Unknown'}</dd>
                    <dt>Server</dt>
                    <dd>{SIDE_LABELS[details.serverSide] ?? 'Unknown'}</dd>
                  </dl>
                </section>
              )}
              <section>
                <h3>Details</h3>
                <dl className="project-facts">
                  {details.loaders.length > 0 && (
                    <>
                      <dt>Loaders</dt>
                      <dd>{details.loaders.map(categoryLabel).join(', ')}</dd>
                    </>
                  )}
                  {details.gameVersions.length > 0 && (
                    <>
                      <dt>Minecraft</dt>
                      <dd>{versionRange(details.gameVersions)}</dd>
                    </>
                  )}
                  {details.license && (
                    <>
                      <dt>Licence</dt>
                      <dd>{details.license.name || details.license.id}</dd>
                    </>
                  )}
                  <dt>Published</dt>
                  <dd>{new Date(details.publishedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}</dd>
                </dl>
              </section>
              <section>
                <h3>Links</h3>
                <div className="project-links">
                  <button onClick={() => open(details.links.modrinth)}>
                    <ExternalLink size={14} /> Modrinth page
                  </button>
                  {details.links.source && (
                    <button onClick={() => open(details.links.source!)}>
                      <Code2 size={14} /> Source code
                    </button>
                  )}
                  {details.links.issues && (
                    <button onClick={() => open(details.links.issues!)}>
                      <Bug size={14} /> Report a problem
                    </button>
                  )}
                  {details.links.wiki && (
                    <button onClick={() => open(details.links.wiki!)}>
                      <BookOpen size={14} /> Wiki
                    </button>
                  )}
                  {details.links.discord && (
                    <button onClick={() => open(details.links.discord!)}>
                      <MessageCircle size={14} /> Discord
                    </button>
                  )}
                </div>
              </section>
            </aside>
          )}
        </div>
      </div>

      {viewing !== null && gallery[viewing] && (
        <div className="project-viewer" onMouseDown={(e) => e.target === e.currentTarget && setViewing(null)}>
          <button className="icon-btn project-viewer-close" aria-label="Close image" onClick={() => setViewing(null)}>
            <X size={20} />
          </button>
          {gallery.length > 1 && (
            <button
              className="icon-btn project-viewer-prev"
              aria-label="Previous image"
              onClick={() => setViewing((viewing - 1 + gallery.length) % gallery.length)}
            >
              <ChevronLeft size={24} />
            </button>
          )}
          <figure>
            <img src={gallery[viewing].fullUrl} alt={gallery[viewing].title ?? ''} referrerPolicy="no-referrer" />
            {(gallery[viewing].title || gallery[viewing].description) && (
              <figcaption>
                {gallery[viewing].title && <strong>{gallery[viewing].title}</strong>}
                {gallery[viewing].description && <span>{gallery[viewing].description}</span>}
              </figcaption>
            )}
          </figure>
          {gallery.length > 1 && (
            <button className="icon-btn project-viewer-next" aria-label="Next image" onClick={() => setViewing((viewing + 1) % gallery.length)}>
              <ChevronRight size={24} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
