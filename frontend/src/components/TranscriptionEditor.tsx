import { useRef, useEffect, useCallback, useState } from 'react';
import { TranscriptionLine } from '../types';
import { PaleographicToolbar, insertMarkupAtCursor } from './PaleographicToolbar';
import type { ComparisonByLineEntry } from './SyncedSplitView';

interface LineData {
  line_number: number;
  baseline: number[][];
  boundary: number[][];
}

interface TranscriptionEditorProps {
  lines: TranscriptionLine[];
  lineData?: LineData[];  // Segmentation data for line heights
  onChange: (lines: TranscriptionLine[]) => void;
  currentLine: number;
  onLineChange: (lineIndex: number) => void;
  readOnly?: boolean;
  showConfidence?: boolean;
  comparisonByLine?: ComparisonByLineEntry[];
}

export function TranscriptionEditor({
  lines,
  lineData,
  onChange,
  currentLine,
  onLineChange,
  readOnly = false,
  showConfidence = false,
  comparisonByLine,
}: TranscriptionEditorProps) {
  const lineRefs = useRef<(HTMLInputElement | null)[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [activeInput, setActiveInput] = useState<HTMLInputElement | null>(null);
  
  // Calculate line heights from segmentation data
  const getLineHeight = useCallback((index: number): number => {
    if (!lineData || !lineData[index]?.boundary) {
      return 40; // Default height
    }
    
    const boundary = lineData[index].boundary;
    if (boundary.length < 2) return 40;
    
    // Calculate height from boundary polygon
    const ys = boundary.map(p => p[1]);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const height = maxY - minY;
    
    // Scale to reasonable display height (min 32px, max 80px)
    // Typical manuscript line is ~100-200 pixels, we want ~40-60px display
    const scaledHeight = Math.max(32, Math.min(80, height * 0.4));
    
    return scaledHeight;
  }, [lineData]);
  
  // Focus management
  useEffect(() => {
    if (lineRefs.current[currentLine]) {
      lineRefs.current[currentLine]?.focus();
      // Scroll the line into view
      lineRefs.current[currentLine]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentLine]);
  
  const handleLineTextChange = useCallback((index: number, text: string) => {
    const newLines = [...lines];
    newLines[index] = { ...newLines[index], text };
    onChange(newLines);
  }, [lines, onChange]);
  
  
  const handleInsertMarkup = useCallback((prefix: string, suffix: string) => {
    if (activeInput) {
      const newText = insertMarkupAtCursor(activeInput, prefix, suffix);
      const lineIndex = lineRefs.current.indexOf(activeInput);
      if (lineIndex >= 0) {
        handleLineTextChange(lineIndex, newText);
      }
    }
  }, [activeInput, handleLineTextChange]);
  
  
  return (
    <div id="transcription-editor" className="flex flex-col h-full">
      {!readOnly && (
        <PaleographicToolbar onInsert={handleInsertMarkup} disabled={readOnly} />
      )}
      
      <div ref={containerRef} className="flex-1 overflow-y-auto p-4" role="region" aria-label="Transcription editor">
        {lines.map((line, index) => {
          const comparison = comparisonByLine?.[index];
          return (
          <div
            key={line.id || index}
            className={`transcription-line ${currentLine === index ? 'bg-blue-50' : ''}`}
            style={{ minHeight: `${getLineHeight(index)}px` }}
            role="group"
            aria-label={`Line ${index + 1}`}
          >
            <span className="text-gray-400 text-sm w-8 text-left" aria-hidden="true">
              {index + 1}
            </span>
            
            <input
              type="text"
              ref={(el) => (lineRefs.current[index] = el)}
              value={line.text || ''}
              onChange={(e) => handleLineTextChange(index, e.target.value)}
              onFocus={() => {
                onLineChange(index);
                setActiveInput(lineRefs.current[index]);
              }}
              readOnly={readOnly}
              className="font-hebrew text-lg transcription-input"
              dir="rtl"
              aria-label={`Line ${index + 1} transcription`}
              aria-describedby={line.notes ? `note-${line.id}` : undefined}
            />
            
            {showConfidence && comparison != null && (
              <span
                className="text-xs px-1 rounded"
                role="status"
                title={`Edit distance: ${comparison.distance}`}
                aria-label={`CER: ${Math.round(comparison.cer * 100)}%`}
              >
                CER: {Math.round(comparison.cer * 100)}% ({comparison.distance})
              </span>
            )}
            
            {!readOnly && (
              <button
                className="text-gray-400 hover:text-gray-600 p-1"
                onClick={() => {
                  // Toggle notes field
                }}
                aria-label={`Notes for line ${index + 1}`}
                title="Add notes"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                </svg>
              </button>
            )}
          </div>
          );
        })}
        
        {lines.length === 0 && (
          <p className="text-gray-500 text-center py-8">
            No lines detected. Run line detection first.
          </p>
        )}
      </div>
    </div>
  );
}
