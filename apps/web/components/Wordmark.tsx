// COACH in ink, .VISION in accent. Archivo set expanded and uppercase — the
// width axis is what makes it read as a scoreboard rather than a startup logo.
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`font-display text-[1.05rem] font-bold uppercase tracking-[0.02em] ${className}`}
      style={{ fontVariationSettings: '"wdth" 118' }}
    >
      <span className="text-ink">Coach</span>
      <span className="text-accent">.Vision</span>
    </span>
  );
}
