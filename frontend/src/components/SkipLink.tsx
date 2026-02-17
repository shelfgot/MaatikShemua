export function SkipLinks() {
  return (
    <nav aria-label="Skip links" className="sr-only focus-within:not-sr-only">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <a href="#transcription-editor" className="skip-link">
        Skip to transcription editor
      </a>
    </nav>
  );
}
