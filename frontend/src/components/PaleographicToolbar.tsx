interface PaleographicToolbarProps {
  onInsert: (prefix: string, suffix: string) => void;
  disabled?: boolean;
}

const MARKUP_BUTTONS = [
  { label: '[...]', prefix: '[', suffix: ']', title: 'Lacuna (Ctrl+L)', shortcut: 'Ctrl+L' },
  { label: '⟨...⟩', prefix: '⟨', suffix: '⟩', title: 'Editorial addition (Ctrl+A)', shortcut: 'Ctrl+A' },
  { label: '{...}', prefix: '{', suffix: '}', title: 'Scribal deletion (Ctrl+D)', shortcut: 'Ctrl+D' },
  { label: '?', prefix: '', suffix: '?', title: 'Uncertain reading (Ctrl+U)', shortcut: 'Ctrl+U' },
  { label: '״', prefix: '״', suffix: '', title: 'Gershayim (Ctrl+Q)', shortcut: 'Ctrl+Q' },
  { label: '׳', prefix: '׳', suffix: '', title: 'Geresh (Ctrl+G)', shortcut: 'Ctrl+G' },
];

export function PaleographicToolbar({ onInsert, disabled }: PaleographicToolbarProps) {
  return (
    <div className="paleo-toolbar" role="toolbar" aria-label="Paleographic markup">
      {MARKUP_BUTTONS.map((btn) => (
        <button
          key={btn.label}
          className="paleo-btn font-hebrew"
          onClick={() => onInsert(btn.prefix, btn.suffix)}
          title={btn.title}
          disabled={disabled}
          aria-label={btn.title}
        >
          {btn.label}
        </button>
      ))}
    </div>
  );
}

// Helper to insert markup at cursor position
// Works with both HTMLInputElement and HTMLTextAreaElement
export function insertMarkupAtCursor(
  element: HTMLInputElement | HTMLTextAreaElement,
  prefix: string,
  suffix: string
): string {
  const start = element.selectionStart ?? 0;
  const end = element.selectionEnd ?? 0;
  const text = element.value;
  const selectedText = text.substring(start, end);
  
  const newText = text.substring(0, start) + prefix + selectedText + suffix + text.substring(end);
  
  // Update element
  element.value = newText;
  
  // Set cursor position
  const newCursorPos = start + prefix.length + selectedText.length + suffix.length;
  element.setSelectionRange(newCursorPos, newCursorPos);
  element.focus();
  
  return newText;
}
