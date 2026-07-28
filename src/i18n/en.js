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
};
