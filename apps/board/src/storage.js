// The autosave keys, and the crash-recovery stash.
//
// These live in their own module because BOTH the app shell and the error
// boundary in main.jsx need them, and main.jsx renders outside the app — it
// used to hardcode the "drillboard:autosave" string, so renaming the key in one
// place would have quietly broken recovery in the other.
//
// Every access is wrapped: Safari in private mode throws on localStorage rather
// than returning null, and a coach hitting that on the bench should get a
// no-op, not a second crash inside the crash screen.

export const SAVE_KEY = "drillboard:autosave";
// The board as it was at the moment of a crash. Only ever written by
// stashAutosave(); the normal autosave never touches it.
export const SAVE_BACKUP_KEY = "drillboard:autosave-backup";

/** Move the autosave aside instead of deleting it. Returns true if something
 *  was actually stashed. This is what "Reset drill & reload" calls: the board
 *  still goes away so a poisoned state can't re-crash the app on boot, but it
 *  is recoverable instead of gone. */
export function stashAutosave() {
  try {
    const cur = localStorage.getItem(SAVE_KEY);
    if (cur) localStorage.setItem(SAVE_BACKUP_KEY, cur);
    localStorage.removeItem(SAVE_KEY);
    return !!cur;
  } catch { return false; }        // private mode — nothing to stash, nothing lost
}

/** The stashed board's DSL, or null. Used to decide whether to offer a restore
 *  at all, so the menu row doesn't appear when there's nothing behind it. */
export function peekBackup() {
  try { return localStorage.getItem(SAVE_BACKUP_KEY) || null; } catch { return null; }
}

/** Drop the stash — after a successful restore, so the offer stops appearing
 *  for a board the coach has already got back. */
export function clearBackup() {
  try { localStorage.removeItem(SAVE_BACKUP_KEY); } catch { /* private mode */ }
}
