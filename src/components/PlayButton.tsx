import { LoaderCircle, Play, Square } from 'lucide-react';
import { progressPercent } from './ProgressBar';
import type { LaunchStatus } from '../types';

interface Props {
  launch?: LaunchStatus;
  onPlay: () => void;
  onStop: () => void;
  large?: boolean;
}

export default function PlayButton({ launch, onPlay, onStop, large }: Props) {
  const size = large ? 'btn-play btn-play-lg' : 'btn-play';
  const iconSize = large ? 18 : 15;

  if (launch?.state === 'installing') {
    const percent = progressPercent(launch.progress);
    return (
      <button className={`btn btn-primary ${size}`} disabled>
        <LoaderCircle size={iconSize} className="spin" /> {percent === null ? 'Starting' : `${percent}%`}
      </button>
    );
  }
  if (launch?.state === 'running') {
    return (
      <button className={`btn btn-stop ${size}`} onClick={onStop}>
        <Square size={iconSize - 3} fill="currentColor" /> Stop
      </button>
    );
  }
  return (
    <button className={`btn btn-primary ${size}`} onClick={onPlay}>
      <Play size={iconSize} fill="currentColor" /> Play
    </button>
  );
}
