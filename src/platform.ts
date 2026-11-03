// Which computer Workbench is running on, for the few things that differ.
export const isMac = window.workbench.platform === 'darwin';

/** A keyboard shortcut as this computer writes it: "Ctrl+S" on Windows and Linux, "⌘S" on a Mac. */
export const shortcut = (key: string, shift = false) => (isMac ? `${shift ? '⇧' : ''}⌘${key}` : `Ctrl+${shift ? 'Shift+' : ''}${key}`);
