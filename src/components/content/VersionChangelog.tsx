import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import Markdown from '../Markdown';
import { api } from '../../api';

/** A version's changelog. CurseForge lists versions without them, so those are fetched when shown. */
export default function VersionChangelog({ projectId, version }: { projectId: string; version: { id: string; changelog: string } }) {
  const listed = version.changelog.trim();
  const fetchIt = !listed && projectId.startsWith('cf:');
  const [text, setText] = useState<string | null>(fetchIt ? null : listed);

  useEffect(() => {
    if (!fetchIt) return setText(listed);
    let current = true;
    setText(null);
    api.content
      .versionChangelog(projectId, version.id)
      .then((t) => current && setText(t.trim()))
      .catch(() => current && setText(''));
    return () => {
      current = false;
    };
  }, [projectId, version.id, listed, fetchIt]);

  if (text === null) return <LoaderCircle size={16} className="spin" aria-label="Loading changelog" />;
  return text ? <Markdown text={text} /> : <p className="changelog-none">No changelog for this version.</p>;
}
