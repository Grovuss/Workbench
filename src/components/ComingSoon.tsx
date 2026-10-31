const ITEMS = [
  { title: 'Update All Mods', body: 'Check for and apply mod updates' },
  { title: 'CurseForge Packs', body: 'Import CurseForge modpacks' },
  { title: 'Resource Packs', body: 'Browse resource packs and shaders' },
  { title: 'Open .workbench Files', body: 'Double-click a pack to import it' },
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
