// ONE spelling for ad names everywhere. The ad name is the join key that
// connects report metrics to concepts (and through them to cycles), and the
// paid team's sheets are inconsistent about separator spacing — the same ad
// appears as "Information _Guess_15s" in one export and "Information _ Guess _
// 15s" in another. Every write path (report imports, quick entry, concept
// create/edit, quick-create) runs through this so equality joins always work.
export function canonicalAdName(raw: string): string {
  return raw
    .trim()
    .replace(/(\.(mp4|mov|m4v|webm))+$/i, "") // pasted Drive filenames carry extensions
    .replace(/\s*\|\s*/g, " _ ") // Drive filenames use pipes
    .replace(/\s*_\s*/g, " _ ") // uniform " _ " around every separator
    .replace(/\s{2,}/g, " ")
    .trim();
}
