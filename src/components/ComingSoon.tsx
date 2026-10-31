const ITEMS = [
  { title: 'CurseForge Packs', body: 'Import CurseForge modpacks (waiting on an API key)' },
  { title: 'Microsoft sign-in', body: 'Play online with your own account (waiting on approval)' },
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
