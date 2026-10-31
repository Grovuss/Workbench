const ITEMS = [
  { title: 'Mod Loaders', body: 'Fabric, Forge and NeoForge profiles' },
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
