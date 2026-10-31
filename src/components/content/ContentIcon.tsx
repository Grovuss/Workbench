import { Puzzle } from 'lucide-react';

export default function ContentIcon({ url, size = 44 }: { url: string | null; size?: number }) {
  return url ? (
    <img className="mod-icon" src={url} alt="" width={size} height={size} loading="lazy" />
  ) : (
    <div className="mod-icon" style={{ width: size, height: size }}>
      <Puzzle size={size / 2.2} />
    </div>
  );
}
