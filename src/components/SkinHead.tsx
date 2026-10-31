import type { CSSProperties } from 'react';

interface Props {
  skinUrl: string | null;
  name: string;
  size?: number;
}

/** Renders the face (plus hat layer) straight from a skin texture with CSS cropping. */
export default function SkinHead({ skinUrl, name, size = 36 }: Props) {
  if (!skinUrl) {
    return (
      <div className="skin-head skin-head-empty" style={{ width: size, height: size }}>
        {name.charAt(0).toUpperCase()}
      </div>
    );
  }

  const url = skinUrl.replace(/^http:/, 'https:');
  // Skins are 64px wide with the face at (8,8) and the hat at (40,8), each 8×8.
  const layer = (column: number): CSSProperties => ({
    backgroundImage: `url("${url}")`,
    backgroundSize: `${size * 8}px auto`,
    backgroundPosition: `-${size * column}px -${size}px`,
  });

  return (
    <div className="skin-head" style={{ width: size, height: size }} role="img" aria-label={name}>
      <div style={layer(1)} />
      <div style={layer(5)} />
    </div>
  );
}
