import type { ReactNode } from 'react';

/** A titled group of settings rows; `id` is what the side index scrolls to. */
export function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  return (
    <section id={`settings-${id}`} className="settings-section" aria-labelledby={`settings-${id}-title`}>
      <h2 id={`settings-${id}-title`} className="section-label">
        {title}
      </h2>
      {description && <p className="settings-section-text">{description}</p>}
      <div className="settings-group">{children}</div>
    </section>
  );
}

/** One setting: what it is on the left, its control on the right. */
export function Row({ title, description, children }: { title: string; description: ReactNode; children: ReactNode }) {
  return (
    <div className="settings-row">
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      {children}
    </div>
  );
}
