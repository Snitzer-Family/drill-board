// English — the reference dictionary. Every other language is checked against
// this one for key parity and placeholder parity by tests/i18n.mjs.
//
// ── Rules for every dictionary in this directory ──────────────────────────
//
// 1. CARRIER NOUNS. A {placeholder} is NEVER inflected — it holds a jersey
//    code (F1, X, D2) which stays bare in all seven languages. Where the
//    grammar needs a case, put a carrier noun next to the placeholder and let
//    IT take the ending:
//        en  "{who} passes to {to}"
//        fi  "{who} syöttää pelaajalle {to}"   ← allative on *pelaajalle*
//        cs  "{who} přihrává na hráče {to}"
//        de  "{who} spielt zu Spieler {to}"
//    This is the difference between grammatical output and gibberish.
//
// 2. WHOLE SENTENCES, never fragments joined at runtime. Word order moves
//    between these languages; a stem plus an appended suffix cannot survive
//    German. That's why `step.shoot.goal` is a whole sentence rather than
//    `step.shoot` + `step.out.goal`.
//
// 3. DSL KEYWORDS ARE CODE. Anything inside `backticks` and every ALL-CAPS
//    bold word (PIECE, PATH, pass=, face=) is drill syntax — copy it verbatim,
//    translate only the prose around it. Machine-enforced for `dsl.ref.*`.
//
// 4. LENGTH BUDGETS. Keys under the prefixes in BUDGET (src/i18n.js) have a
//    hard character limit because they render in fixed-width controls. Over
//    budget fails the build. `bar.*` is 7 characters — these are captions
//    under an icon, and terse is correct.
//
// 5. PLACEHOLDERS MUST MATCH. Same {names}, same count, as the English value.
//
// 6. Present tense throughout. It sidesteps French past-participle gender
//    agreement and reads correctly as a live play-by-play.

export default {
  /* ── Tune → Display: the language setting ── */
  "prefs.language": "Language",
  "prefs.lang.auto": "Auto",
  "prefs.lang.hint.auto": "follows your phone’s language — currently {lang}",
  "prefs.lang.hint.pinned": "pinned to {lang}, ignoring your phone’s language",

  /* ── bottom bar. Captions under an icon, hard-capped at 7 rendered
     characters by BUDGET — the buttons are a fixed 50px and cannot grow.
     {dir} is the half-ice arrow (↑↓←→), one glyph. ── */
  "bar.menu": "Menu",
  "bar.rink.full": "Full",
  "bar.rink.half": "Half {dir}",
  "bar.rink.quarter": "¼ ice",
  "bar.add": "Add",
  "bar.tune": "Tune",
  "bar.undo": "Undo",
  "bar.redo": "Redo",

  /* tooltips — desktop hover only, so no length pressure */
  "bar.title.menu": "Menu",
  "bar.title.rink": "Rink",
  "bar.title.add": "Add / draw",
  "bar.title.tune": "Settings",
  "bar.title.undo": "Undo last change",
  "bar.title.redo": "Redo",

  /* ── shared scraps ── */
  "common.on": "On",
  "common.off": "Off",

  /* ── ☰ menu ── */
  "menu.section.drill": "Drill",
  "menu.field.name": "Drill name",
  "menu.field.desc": "Description",
  "menu.item.notes": "Notes / writeup",
  "menu.item.inventory": "Inventory / gear",
  "menu.item.print": "Print sheet…",
  "menu.item.textEditor": "Text editor",
  "menu.item.exportTxt": "Export .txt",
  "menu.item.exportMd": "Export .md",
  "menu.item.exportImage": "Export image",
  "menu.item.copyMd": "Copy markdown",
  "menu.item.shareLink": "Share preview link",
  "menu.item.load": "Load .txt / .md",
  "menu.item.restore": "Restore last board",
  "menu.item.importPhoto": "Import from photo…",
  "menu.item.iceZones": "Ice zones",
  "menu.item.unlockAll": "Unlock all",
  "menu.item.lockBoard": "Lock board",
  "menu.item.selectLocked": "Allow selecting locked items",
  "menu.item.diagnostics": "Diagnostics",
  "menu.item.appSettings": "App & drill settings",
  "menu.item.clearAll": "Clear all",

  "menu.section.aiPlay": "Let AI play",
  "menu.ai.for": "5v5 for",
  "menu.ai.start": "Start",

  "menu.section.presentation": "Presentation",
  "menu.preso.pause": "Pause",
  "menu.preso.minorSteps": "Minor steps",
  "menu.preso.minorSteps.hint": "auto-caption the areas each player skates through",
  "menu.preso.editSteps": "Edit steps",
  "menu.preso.stepCount.one": "{n} step — play pauses at each",
  "menu.preso.stepCount.other": "{n} steps — play pauses at each",
  "menu.preso.noSteps": "scrub, pause, add your own",

  "menu.note.help": "Tap a piece, route point, or line for its settings. Double-tap a line to add a point. Drag to move; touch drags show a magnifier.",

  /* ── toasts ── */
  "toast.savedBoardUnreadable": "That saved board can't be read",
  "toast.boardRestored": "Board restored",
  "toast.boardCleared": "Board cleared — Undo restores it",
  "toast.pen.noInkClear": "No ink to clear",
  "toast.pen.noInkConvert": "No ink to convert",
  "toast.pen.nothingRecognised": "Nothing recognised in the ink",
  "toast.pen.drawFirst": "Draw something with the pen first",
  "toast.pen.erased": "Erased {what}",
  "toast.pen.cleared.one": "Cleared {n} ink mark — Undo restores them",
  "toast.pen.cleared.other": "Cleared {n} ink marks — Undo restores them",
  "toast.panel.unpinned": "Un-pinned — panel closes on the next ice tap",
  "toast.panel.pinned": "Pinned — panel stays open and follows what you tap",
  "toast.stepsGenerated": "Steps generated from the play",
  "toast.backToStart": "Back to start — editing",
  "toast.netAdded": "Added a net to shoot at",
  "toast.boardReplaced": "Board replaced — Undo restores the old drill",
  "toast.imageExportFailed": "Image export failed",
  "toast.copyFailed": "Copy failed — use Export or Share instead",
  "toast.linkUnreadable": "Couldn't read the shared drill link — showing your saved board instead",
  "toast.allowPopups": "Allow pop-ups to print",
  "toast.drillLoaded": "Drill loaded — Undo restores the old board",
  "toast.apiKeyNeeded.photo": "Add your Claude API key to import photos",
  "toast.needPasser": "Add another player to pass from",
  "toast.needTarget": "Add a player, passer, tire, or bumper to pass to",
  "toast.routeCleared": "Route cleared — Undo restores it",
  "toast.legRemoved": "Leg removed — Undo restores it",
  "toast.apiKeySaved": "API key saved",
  "toast.apiKeyCleared": "API key cleared",
  "toast.notesCleared": "Notes cleared — Undo restores them",
  "toast.deletedPiece": "Deleted {id} — Undo restores it",
  "toast.deletedItems.one": "Deleted {n} item — Undo restores them",
  "toast.deletedItems.other": "Deleted {n} items — Undo restores them",
  "toast.saved": "Saved {file}",

  /* ── Tune → Display: theme. The scheme names are descriptive (a sheet of
     ice, a hockey barn, slate grey), so they translate rather than transliterate. ── */
  "prefs.section.display": "Display",
  "prefs.theme": "Theme",
  "prefs.theme.auto": "Auto",
  "prefs.theme.light": "Light",
  "prefs.theme.dark": "Dark",
  "prefs.theme.sheet": "Sheet",
  "prefs.theme.barn": "Barn",
  "prefs.theme.slate": "Slate",
  "prefs.theme.hint.auto": "follows your phone’s appearance — currently {theme}",
  "prefs.theme.hint.pinned": "pinned to {theme}, ignoring your phone’s appearance",
};
