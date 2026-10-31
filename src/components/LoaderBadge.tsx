import { LOADER_LABELS } from '../loaders';
import type { Loader } from '../types';

export default function LoaderBadge({ loader }: { loader: Loader }) {
  return <span className={`badge badge-${loader}`}>{LOADER_LABELS[loader]}</span>;
}
