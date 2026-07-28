// node tests/storage.mjs — the crash-recovery stash.
//
// "Reset drill & reload" on the error boundary is the only destructive action
// in the app and the one a coach reaches for at the rink, so the guarantee it
// makes is worth pinning: the board LEAVES the autosave slot (a poisoned board
// must not be able to re-crash on boot) but is still recoverable afterwards.

import assert from "node:assert/strict";

let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log(`ok  ${name}`); };

// minimal localStorage stub; `mode` lets us simulate Safari private browsing,
// which THROWS on access rather than returning null
function stubStorage(mode = "ok") {
  const map = new Map();
  const guard = () => { if (mode === "throw") throw new Error("SecurityError"); };
  globalThis.localStorage = {
    getItem: k => { guard(); return map.has(k) ? map.get(k) : null; },
    setItem: (k, v) => { guard(); map.set(k, String(v)); },
    removeItem: k => { guard(); map.delete(k); },
  };
  return map;
}

stubStorage();
const { SAVE_KEY, SAVE_BACKUP_KEY, stashAutosave, peekBackup, clearBackup } =
  await import("../apps/board/src/storage.js");

check("stash moves the board aside rather than deleting it", () => {
  const map = stubStorage();
  map.set(SAVE_KEY, "RINK full\nPIECE P1 player 40 40\n");
  assert.equal(stashAutosave(), true, "should report that it stashed something");
  assert.equal(map.get(SAVE_KEY), undefined, "autosave slot must be cleared");
  assert.match(peekBackup(), /PIECE P1/, "the board must survive in the backup slot");
});

check("restoring clears the stash so the offer stops re-appearing", () => {
  const map = stubStorage();
  map.set(SAVE_KEY, "RINK full\n");
  stashAutosave();
  assert.ok(peekBackup(), "precondition: something is stashed");
  clearBackup();
  assert.equal(peekBackup(), null);
});

check("stashing an empty board reports nothing was kept", () => {
  stubStorage();                       // no autosave present
  assert.equal(stashAutosave(), false, "nothing to stash");
  assert.equal(peekBackup(), null, "and nothing offered to restore");
});

check("a second crash does not overwrite the stash with an empty board", () => {
  const map = stubStorage();
  map.set(SAVE_KEY, "RINK full\nPIECE KEEP player 1 1\n");
  stashAutosave();                     // real crash: board is stashed
  // the app reboots to the demo and the coach crashes again before restoring
  stashAutosave();
  assert.match(peekBackup(), /KEEP/,
    "the ORIGINAL board must still be there — a second reset must not clobber it");
});

check("private mode degrades to a no-op instead of throwing", () => {
  stubStorage("throw");
  assert.doesNotThrow(() => stashAutosave(), "stash must not throw");
  assert.doesNotThrow(() => peekBackup(), "peek must not throw");
  assert.doesNotThrow(() => clearBackup(), "clear must not throw");
  assert.equal(stashAutosave(), false);
  assert.equal(peekBackup(), null, "no offer to restore when storage is unavailable");
});

check("the two keys are distinct", () => {
  assert.notEqual(SAVE_KEY, SAVE_BACKUP_KEY);
  assert.match(SAVE_KEY, /^drillboard:/);
  assert.match(SAVE_BACKUP_KEY, /^drillboard:/);
});

console.log(`\n${passed} passed, 0 failed`);
