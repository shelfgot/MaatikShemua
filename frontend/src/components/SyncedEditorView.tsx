import { useRef, useEffect, useState, useCallback } from 'react';
import { TranscriptionLine } from '../types';
import { PaleographicToolbar, insertMarkupAtCursor } from './PaleographicToolbar';
import type { ComparisonByLineEntry } from './SyncedSplitView';

interface LineData {
  line_number: number;
  baseline: number[][];
  boundary: number[][];
}

interface SyncedEditorViewProps {
  imageUrl: string;
  lines: TranscriptionLine[];
  lineData: LineData[];
  onChange: (lines: TranscriptionLine[]) => void;
  currentLine: number;
  onLineChange: (lineIndex: number) => void;
  readOnly?: boolean;
  showConfidence?: boolean;
  comparisonByLine?: ComparisonByLineEntry[];
}

export function SyncedEditorView({
  imageUrl,
  lines,
  lineData,
  onChange,
  currentLine,
  onLineChange,
  readOnly = false,
  showConfidence = false,
  comparisonByLine,
}: SyncedEditorViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const lineRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [activeInput, setActiveInput] = useState<HTMLInputElement | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0, naturalWidth: 0, naturalHeight: 0 });

  // Handle image load
  const handleImageLoad = useCallback(() => {
    if (imageRef.current) {
      setImageDimensions({
        width: imageRef.current.clientWidth,
        height: imageRef.current.clientHeight,
        naturalWidth: imageRef.current.naturalWidth,
        naturalHeight: imageRef.current.naturalHeight,
      });
      setImageLoaded(true);
    }
  }, []);

  // Recalculate on resize
  useEffect(() => {
    const handleResize = () => {
      if (imageRef.current && imageLoaded) {
        setImageDimensions({
          width: imageRef.current.clientWidth,
          height: imageRef.current.clientHeight,
          naturalWidth: imageRef.current.naturalWidth,
          naturalHeight: imageRef.current.naturalHeight,
        });
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [imageLoaded]);

  // Calculate line position based on boundary
  const getLinePosition = useCallback((index: number) => {
    if (!lineData[index]?.boundary || imageDimensions.naturalHeight === 0) {
      return { top: index * 40, height: 36 };
    }

    const boundary = lineData[index].boundary;
    const ys = boundary.map(p => p[1]);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    
    // Scale to displayed image size
    const scale = imageDimensions.height / imageDimensions.naturalHeight;
    
    return {
      top: minY * scale,
      height: Math.max(28, (maxY - minY) * scale),
    };
  }, [lineData, imageDimensions]);

  // Handle text change
  const handleLineTextChange = useCallback((index: number, text: string) => {
    const newLines = [...lines];
    newLines[index] = { ...newLines[index], text };
    onChange(newLines);
  }, [lines, onChange]);

  // Handle markup insertion
  const handleInsertMarkup = useCallback((prefix: string, suffix: string) => {
    if (activeInput) {
      const newText = insertMarkupAtCursor(activeInput, prefix, suffix);
      const lineIndex = lineRefs.current.indexOf(activeInput);
      if (lineIndex >= 0) {
        handleLineTextChange(lineIndex, newText);
      }
    }
  }, [activeInput, handleLineTextChange]);

  // Focus current line
  useEffect(() => {
    if (lineRefs.current[currentLine]) {
      lineRefs.current[currentLine]?.focus();
      lineRefs.current[currentLine]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentLine]);


  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      {!readOnly && (
        <PaleographicToolbar onInsert={handleInsertMarkup} disabled={readOnly} />
      )}

      {/* Synced view container */}
      <div 
        ref={containerRef}
        className="flex-1 overflow-auto bg-gray-100"
      >
        <div className="relative inline-block min-w-full">
          {/* Image */}
          <img
            ref={imageRef}
            src={imageUrl}
            alt="Document page"
            onLoad={handleImageLoad}
            className="block max-w-full h-auto"
            style={{ minWidth: '100%' }}
          />

          {/* Overlay container for transcription lines */}
          {imageLoaded && (
            <div 
              className="absolute top-0 left-0 w-full"
              style={{ height: imageDimensions.height }}
            >
              {lines.map((line, index) => {
                const pos = getLinePosition(index);
                const isActive = currentLine === index;
                const comparison = comparisonByLine?.[index];

                return (
                  <div
                    key={line.id || index}
                    className={`absolute flex items-center gap-2 transition-all ${
                      isActive ? 'z-20' : 'z-10'
                    }`}
                    style={{
                      top: pos.top,
                      left: 0,
                      right: 0,
                      height: pos.height,
                    }}
                  >
                    {/* Line number */}
                    <span 
                      className={`flex-shrink-0 w-8 text-center text-xs font-medium rounded
                        ${isActive ? 'bg-blue-600 text-white' : 'bg-white/90 text-gray-600'}`}
                    >
                      {index + 1}
                    </span>

                    {/* Transcription input */}
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
                      className={`flex-1 px-2 py-1 text-base font-hebrew rounded border-0
                        transition-all focus:outline-none focus:ring-2 focus:ring-blue-500
                        ${isActive 
                          ? 'bg-white shadow-lg' 
                          : 'bg-white/70 hover:bg-white/90'
                        }
                      `}
                      style={{ 
                        height: Math.max(24, pos.height - 4),
                        minHeight: 24,
                      }}
                      dir="rtl"
                      placeholder={readOnly ? '' : 'Enter transcription...'}
                      aria-label={`Line ${index + 1} transcription`}
                    />

                    {/* Model-vs-manual CER (and optional distance) */}
                    {showConfidence && comparison != null && (
                      <span
                        className="flex-shrink-0 text-xs bg-white/90 px-1 rounded"
                        title={`Edit distance: ${comparison.distance}`}
                      >
                        CER: {Math.round(comparison.cer * 100)}% ({comparison.distance})
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Line highlights on image */}
          {imageLoaded && (
            <svg 
              className="absolute top-0 left-0 pointer-events-none"
              style={{ width: imageDimensions.width, height: imageDimensions.height }}
            >
              {lineData.map((line, index) => {
                if (!line.boundary || line.boundary.length < 3) return null;
                
                const scale = imageDimensions.height / imageDimensions.naturalHeight;
                const points = line.boundary
                  .map(p => `${p[0] * scale},${p[1] * scale}`)
                  .join(' ');
                
                const isActive = currentLine === index;
                
                return (
                  <polygon
                    key={index}
                    points={points}
                    className={`${isActive ? 'line-overlay active' : 'line-overlay'}`}
                    style={{ pointerEvents: 'none' }}
                  />
                );
              })}
            </svg>
          )}
        </div>
      </div>
    </div>
  );
}
