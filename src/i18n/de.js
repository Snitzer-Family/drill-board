// German. See en.js for the rules every dictionary follows.
//
// German is the binding constraint on every length budget in src/i18n.js —
// when a `bar.*` caption won't fit in 7 characters, shorten the German rather
// than widening the button ("Zurück", not "Rückgängig").

export default {
  /* ── Tune → Display: the language setting ── */
  "prefs.language": "Sprache",
  "prefs.lang.auto": "Auto",
  "prefs.lang.hint.auto": "folgt der Sprache deines Telefons — aktuell {lang}",
  "prefs.lang.hint.pinned": "fest auf {lang}, unabhängig von der Telefonsprache",
};
