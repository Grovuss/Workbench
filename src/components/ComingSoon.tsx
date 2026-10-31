const ITEMS = [
  { title: 'CurseForge Packs', body: 'Import CurseForge modpacks (waiting on an API key)' },
  { title: 'Open .workbench Files', body: 'Double-click a pack to import it' },
  { title: 'Windows Installer', body: 'Install Workbench like any other app' },
];

export default function ComingSoon() {
  return (
    <section>
      <h2 className="section-label">Coming soon</h2>
      <div className="soon-grid">
        {ITEMS.map((item) => (
          <div key={item.title} className="soon-card" aria-disabled="true">
            <span className="soon-pill">Soon</span>
            <h3>{item.title}</h3>
            <p>{item.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
