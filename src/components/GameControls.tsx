import { formatGb } from '../format';
import type { Resolution } from '../types';

// Controls shared by the launcher's game defaults and each profile's own settings.

export const DEFAULT_RESOLUTION: Resolution = { width: 1280, height: 720 };

/** The limits the game and the launcher accept for a window size. */
export const validResolution = ({ width, height }: Resolution) => width >= 320 && width <= 7680 && height >= 240 && height <= 4320;

/** RAM slider in 512 MB steps, with its value. */
export function MemorySlider({ value, max, onChange }: { value: number; max: number; onChange: (mb: number) => void }) {
  return (
    <>
      <input
        type="range"
        className="range"
        min={1024}
        max={max}
        step={512}
        value={Math.min(value, max)}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Memory"
      />
      <span className="memory-value">{formatGb(value)}</span>
    </>
  );
}

/** Width × height boxes for the game window. */
export function ResolutionFields({ value, onChange }: { value: Resolution; onChange: (next: Resolution) => void }) {
  return (
    <div className="resolution-fields">
      <input
        type="number"
        className="input"
        value={value.width}
        min={320}
        max={7680}
        onChange={(e) => onChange({ ...value, width: Number(e.target.value) })}
        aria-label="Width"
      />
      <span>×</span>
      <input
        type="number"
        className="input"
        value={value.height}
        min={240}
        max={4320}
        onChange={(e) => onChange({ ...value, height: Number(e.target.value) })}
        aria-label="Height"
      />
    </div>
  );
}
