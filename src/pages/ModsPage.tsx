import { Puzzle } from 'lucide-react';
import PageHeader from '../components/PageHeader';

export default function ModsPage() {
  return (
    <>
      <PageHeader title="Mods" subtitle="Browse and manage mods across your profiles" />
      <div className="empty">
        <Puzzle className="empty-icon" size={48} strokeWidth={1.5} />
        <h2>Mod browser coming soon</h2>
        <p>Search Modrinth and install mods straight into a profile.</p>
      </div>
    </>
  );
}
