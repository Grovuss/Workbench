const ITEMS = [
  { title: 'Mods Tab', body: 'Manage the mods in each profile' },
  { title: 'Modrinth Search', body: 'Browse and install mods directly' },
  { title: 'Update All Mods', body: 'Check for and apply updates' },
  { title: 'Export Pack', body: 'Export your profile as a .mrpack' },
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
