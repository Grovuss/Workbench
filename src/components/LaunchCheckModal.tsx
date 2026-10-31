import { useState } from 'react';
import { Package, Play } from 'lucide-react';
import Modal from './Modal';
import ProblemList, { applyFix } from './content/ProblemList';
import { api } from '../api';
import type { ProfileTab } from '../pages/ProfilePage';
import type { Problem, Profile } from '../types';

interface Props {
  profile: Profile;
  problems: Problem[];
  onLaunch: () => void;
  onClose: () => void;
  onOpenTab: (tab: ProfileTab) => void;
  onError: (message: string) => void;
}

/** Shown when Play is pressed and the mods have problems: fix them here, or play anyway. */
export default function LaunchCheckModal({ profile, problems: initial, onLaunch, onClose, onOpenTab, onError }: Props) {
  const [problems, setProblems] = useState(initial);
  const goTo = (tab: ProfileTab) => {
    onClose();
    onOpenTab(tab);
  };
  const fixed = problems.length === 0;

  return (
    <Modal
      title={fixed ? 'Ready to play' : `Problems with ${profile.name}’s mods`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={() => goTo('content')}>
            <Package size={15} /> Open mods
          </button>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className={`btn ${fixed ? 'btn-primary' : 'btn-secondary'}`} onClick={onLaunch}>
            <Play size={15} /> {fixed ? 'Play' : 'Play anyway'}
          </button>
        </>
      }
    >
      {fixed ? (
        <p className="modal-text">Everything Workbench found is fixed.</p>
      ) : (
        <>
          <p className="modal-text">
            {problems.length === 1 ? 'This will' : 'These will'} probably stop the game from starting, or crash it. Fix{' '}
            {problems.length === 1 ? 'it' : 'them'} here, or play anyway.
          </p>
          <div className="launch-check-list">
            <ProblemList
              key={problems.map((p) => p.id).join()}
              problems={problems}
              onFix={async (fix) => {
                await applyFix(profile.id, fix, { onOpenSettings: () => goTo('settings') });
                if (fix.type !== 'settings') setProblems(await api.diagnose.scan(profile.id));
              }}
              onError={onError}
            />
          </div>
        </>
      )}
    </Modal>
  );
}
