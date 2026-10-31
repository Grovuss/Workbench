import { Upload } from 'lucide-react';
import PageHeader from '../components/PageHeader';

export default function ImportPage() {
  return (
    <>
      <PageHeader
        title="Import Pack"
        subtitle="Import a Modrinth .mrpack or CurseForge .zip modpack"
      />

      <div className="import-grid">
        <button className="import-card modrinth">
          <div className="import-icon">
            <Upload size={20} />
          </div>
          <h3>
            Modrinth Pack <code>.mrpack</code>
          </h3>
          <p>Import a Modrinth modpack. Mods are downloaded automatically from Modrinth's CDN.</p>
        </button>

        <button className="import-card curseforge">
          <div className="import-icon">
            <Upload size={20} />
          </div>
          <h3>
            CurseForge Pack <code>.zip</code>
          </h3>
          <p>Import a CurseForge modpack. Overrides are copied; mod downloads are listed for manual install.</p>
        </button>
      </div>
    </>
  );
}
