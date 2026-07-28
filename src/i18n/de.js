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

  /* ── bottom bar — max 7 rendered characters, see en.js.
     "Zurück" not "Rückgängig", "Vor" not "Wiederholen": the button is 50px
     and the caption cannot wrap. Short is the requirement, not a shortcut. ── */
  "bar.menu": "Menü",
  "bar.rink.full": "Ganz",
  "bar.rink.half": "Halb {dir}",
  "bar.rink.quarter": "¼ Eis",
  "bar.add": "Neu",
  "bar.tune": "Regler",
  "bar.undo": "Zurück",
  "bar.redo": "Vor",

  "bar.title.menu": "Menü",
  "bar.title.rink": "Eisfläche",
  "bar.title.add": "Hinzufügen / zeichnen",
  "bar.title.tune": "Einstellungen",
  "bar.title.undo": "Letzte Änderung rückgängig machen",
  "bar.title.redo": "Wiederholen",

  /* ── shared scraps ── */
  "common.on": "An",
  "common.off": "Aus",

  /* ── ☰ menu ── */
  "menu.section.drill": "Übung",
  "menu.field.name": "Name der Übung",
  "menu.field.desc": "Beschreibung",
  "menu.item.notes": "Notizen",
  "menu.item.inventory": "Material",
  "menu.item.print": "Blatt drucken…",
  "menu.item.textEditor": "Texteditor",
  "menu.item.exportTxt": "Als .txt export.",
  "menu.item.exportMd": "Als .md export.",
  "menu.item.exportImage": "Als Bild exportieren",
  "menu.item.copyMd": "Markdown kopieren",
  "menu.item.shareLink": "Vorschaulink teilen",
  "menu.item.load": ".txt / .md laden",
  "menu.item.restore": "Letzte Tafel wiederherstellen",
  "menu.item.importPhoto": "Aus Foto importieren…",
  "menu.item.iceZones": "Eiszonen",
  "menu.item.unlockAll": "Alle entsperren",
  "menu.item.lockBoard": "Tafel sperren",
  "menu.item.selectLocked": "Gesperrte auswählbar machen",
  "menu.item.diagnostics": "Diagnose",
  "menu.item.appSettings": "App- und Übungseinstellungen",
  "menu.item.clearAll": "Alles löschen",

  "menu.section.aiPlay": "KI spielen lassen",
  "menu.ai.for": "5 gegen 5 für",
  "menu.ai.start": "Start",

  "menu.section.presentation": "Präsentation",
  "menu.preso.pause": "Pause",
  "menu.preso.minorSteps": "Zwischenschritte",
  "menu.preso.minorSteps.hint": "die Zonen, die jeder Spieler durchläuft, automatisch beschriften",
  "menu.preso.editSteps": "Schritte bearbeiten",
  "menu.preso.stepCount.one": "{n} Schritt — die Wiedergabe hält bei jedem an",
  "menu.preso.stepCount.other": "{n} Schritte — die Wiedergabe hält bei jedem an",
  "menu.preso.noSteps": "spulen, pausieren, eigene ergänzen",

  "menu.note.help": "Tippe auf eine Figur, einen Routenpunkt oder eine Linie, um ihre Einstellungen zu öffnen. Doppeltippen auf eine Linie fügt einen Punkt hinzu. Ziehen verschiebt; beim Ziehen mit dem Finger erscheint eine Lupe.",

  /* ── toasts ── */
  "toast.savedBoardUnreadable": "Diese gespeicherte Tafel ist nicht lesbar",
  "toast.boardRestored": "Tafel wiederhergestellt",
  "toast.boardCleared": "Tafel geleert — Zurück stellt sie wieder her",
  "toast.pen.noInkClear": "Keine Striche zum Löschen",
  "toast.pen.noInkConvert": "Keine Striche zum Umwandeln",
  "toast.pen.nothingRecognised": "In den Strichen wurde nichts erkannt",
  "toast.pen.drawFirst": "Zeichne zuerst etwas mit dem Stift",
  "toast.pen.erased": "Gelöscht: {what}",
  "toast.pen.cleared.one": "{n} Strich gelöscht — Zurück stellt sie wieder her",
  "toast.pen.cleared.other": "{n} Striche gelöscht — Zurück stellt sie wieder her",
  "toast.panel.unpinned": "Gelöst — das Panel schließt beim nächsten Tippen aufs Eis",
  "toast.panel.pinned": "Angeheftet — das Panel bleibt offen und folgt deinen Tipps",
  "toast.stepsGenerated": "Schritte aus dem Spielzug erzeugt",
  "toast.backToStart": "Zurück zum Anfang — Bearbeiten",
  "toast.netAdded": "Ein Tor zum Schießen hinzugefügt",
  "toast.boardReplaced": "Tafel ersetzt — Zurück stellt die alte Übung wieder her",
  "toast.imageExportFailed": "Bildexport fehlgeschlagen",
  "toast.copyFailed": "Kopieren fehlgeschlagen — nutze Exportieren oder Teilen",
  "toast.linkUnreadable": "Der geteilte Übungslink war nicht lesbar — zeige stattdessen deine gespeicherte Tafel",
  "toast.allowPopups": "Pop-ups zum Drucken erlauben",
  "toast.drillLoaded": "Übung geladen — Zurück stellt die alte Tafel wieder her",
  "toast.apiKeyNeeded.photo": "Füge deinen Claude-API-Schlüssel hinzu, um Fotos zu importieren",
  "toast.needPasser": "Füge einen weiteren Spieler hinzu, von dem gepasst wird",
  "toast.needTarget": "Füge einen Spieler, Passgeber, Reifen oder Bande zum Anspielen hinzu",
  "toast.routeCleared": "Route gelöscht — Zurück stellt sie wieder her",
  "toast.legRemoved": "Abschnitt entfernt — Zurück stellt ihn wieder her",
  "toast.apiKeySaved": "API-Schlüssel gespeichert",
  "toast.apiKeyCleared": "API-Schlüssel gelöscht",
  "toast.notesCleared": "Notizen gelöscht — Zurück stellt sie wieder her",
  "toast.deletedPiece": "{id} gelöscht — Zurück stellt es wieder her",
  "toast.deletedItems.one": "{n} Objekt gelöscht — Zurück stellt sie wieder her",
  "toast.deletedItems.other": "{n} Objekte gelöscht — Zurück stellt sie wieder her",
  "toast.saved": "{file} gespeichert",

  /* ── Tune → Display: Design ── */
  "prefs.section.display": "Darstellung",
  "prefs.theme": "Design",
  "prefs.theme.auto": "Auto",
  "prefs.theme.light": "Hell",
  "prefs.theme.dark": "Dunkel",
  "prefs.theme.sheet": "Eis",
  "prefs.theme.barn": "Halle",
  "prefs.theme.slate": "Schiefer",
  "prefs.theme.hint.auto": "folgt dem Erscheinungsbild deines Telefons — aktuell {theme}",
  "prefs.theme.hint.pinned": "fest auf {theme}, unabhängig vom Telefon",
};
