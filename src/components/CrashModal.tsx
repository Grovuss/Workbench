import { FileText, ScrollText } from 'lucide-react';
import Modal from './Modal';
import ProblemList, { applyFix } from './content/ProblemList';
import { api, errorMessage } from '../api';
import type { ProfileTab } from '../pages/ProfilePage';
import type { CrashReport, Profile } from '../types';

interface Props {
  profile: Profile;
  report: CrashReport;
  onClose: () => void;
  onOpenTab: (tab: ProfileTab) => void;
  onError: (message: string) => void;
}

/** Shown when the game crashes (or a mod loader stops it): the likely causes and fixes. */
export default function CrashModal({ profile, report, onClose, onOpenTab, onError }: Props) {
  const { problems, crashReport, exitCode } = report;
  const goTo = (tab: ProfileTab) => {
    onClose();
    onOpenTab(tab);
  };

  return (
    <Modal
      title={exitCode ? `${profile.name} crashed` : `${profile.name} couldn’t start`}
      onClose={onClose}
      footer={
        <>
          {crashReport && (
            <button
              className="btn btn-ghost"
              onClick={() => api.diagnose.openCrashReport(profile.id, crashReport).catch((err) => onError(errorMessage(err)))}
            >
              <FileText size={15} /> Crash report
            </button>
          )}
          <button className="btn btn-secondary" onClick={() => goTo('logs')}>
            <ScrollText size={15} /> View logs
          </button>
          <button className="btn btn-primary" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      {problems.length > 0 ? (
        <>
          <p className="modal-text">
            {problems.length === 1 ? 'This is the likely cause.' : 'These are the likely causes.'} Fix them, then press Play again.
          </p>
          <ProblemList
            problems={problems}
            onFix={(fix) => applyFix(profile.id, fix, { onOpenSettings: () => goTo('settings') })}
            onError={onError}
          />
        </>
      ) : (
        <p className="modal-text">
          Workbench couldn’t tell why from the log{exitCode !== null ? ` (exit code ${exitCode})` : ''}. The logs
          {crashReport ? ' and crash report' : ''} have the details. If you added mods recently, try turning them off one at a time.
        </p>
      )}
    </Modal>
  );
}
