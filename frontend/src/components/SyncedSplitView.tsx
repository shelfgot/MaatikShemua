import { useRef, useEffect, useState, useCallback } from 'react';
import { TranscriptionLine } from '../types';
import { PaleographicToolbar, insertMarkupAtCursor } from './PaleographicToolbar';

interface LineData {
  line_number: number;
  baseline: number[][];
  boundary: number[][];
}

export type ComparisonByLineEntry = { distance: number; cer: number } | null;

interface SyncedSplitViewProps {
  imageUrl: string;
  lines: TranscriptionLine[];
  lineData: LineData[];
  onChange: (lines: TranscriptionLine[]) => void;
  currentLine: number;
  onLineChange: (lineIndex: number) => void;
  readOnly?: boolean;
  showConfidence?: boolean;
  comparisonByLine?: ComparisonByLineEntry[];
  syncEnabled?: boolean;
  onSyncToggle?: (enabled: boolean) => void;
}

export function SyncedSplitView({
  imageUrl,
  lines,
  lineData,
  onChange,
  currentLine,
  onLineChange,
  readOnly = false,
  showConfidence = false,
  comparisonByLine,
  syncEnabled = true,
  onSyncToggle,
}: SyncedSplitViewProps) {
  const leftPaneRef = useRef<HTMLDivElement>(null);
  const rightPaneRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const lineRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [activeInput, setActiveInput] = useState<HTMLInputElement | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageDimensions, setImageDimensions] = useState({ 
    width: 0, 
    height: 0, 
    naturalWidth: 0, 
    naturalHeight: 0 
  });
  
  // Track which pane initiated the scroll to prevent feedback loops
  const isScrollingRef = useRef<'left' | 'right' | null>(null);

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

  // Calculate line position based on boundary (for positioning in right pane)
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

  // Sync scroll between panes
  const handleLeftScroll = useCallback(() => {
    if (!syncEnabled || isScrollingRef.current === 'right') return;
    if (!leftPaneRef.current || !rightPaneRef.current) return;
    
    isScrollingRef.current = 'left';
    rightPaneRef.current.scrollTop = leftPaneRef.current.scrollTop;
    
    // Reset scroll source after a short delay
    requestAnimationFrame(() => {
      isScrollingRef.current = null;
    });
  }, [syncEnabled]);

  const handleRightScroll = useCallback(() => {
    if (!syncEnabled || isScrollingRef.current === 'left') return;
    if (!leftPaneRef.current || !rightPaneRef.current) return;
    
    isScrollingRef.current = 'right';
    leftPaneRef.current.scrollTop = rightPaneRef.current.scrollTop;
    
    requestAnimationFrame(() => {
      isScrollingRef.current = null;
    });
  }, [syncEnabled]);

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
    }
  }, [currentLine]);

  // Scroll current line into view in both panes
  useEffect(() => {
    if (!imageLoaded || currentLine < 0 || currentLine >= lineData.length) return;
    
    const pos = getLinePosition(currentLine);
    const scrollTarget = pos.top - 100; // Some padding from top
    
    if (leftPaneRef.current) {
      leftPaneRef.current.scrollTop = Math.max(0, scrollTarget);
    }
    if (rightPaneRef.current) {
      rightPaneRef.current.scrollTop = Math.max(0, scrollTarget);
    }
  }, [currentLine, imageLoaded, getLinePosition, lineData.length]);


  // Calculate total content height (height of image or last line bottom)
  const contentHeight = imageDimensions.height;

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b bg-gray-50 px-2">
        {!readOnly && (
          <PaleographicToolbar onInsert={handleInsertMarkup} disabled={readOnly} />
        )}
        {readOnly && <div />}
        
        {/* Sync toggle button */}
        <button
          onClick={() => onSyncToggle?.(!syncEnabled)}
          className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors
            ${syncEnabled 
              ? 'bg-blue-100 text-blue-700 hover:bg-blue-200' 
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          title={syncEnabled ? 'Scroll sync enabled (click to disable)' : 'Scroll sync disabled (click to enable)'}
        >
          <svg 
            className="w-4 h-4" 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            {syncEnabled ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            )}
          </svg>
          {syncEnabled ? 'Synced' : 'Unsynced'}
        </button>
      </div>

      {/* Main split view */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left pane: Image with line boundaries */}
        <div 
          ref={leftPaneRef}
          className="w-1/2 overflow-auto border-r bg-gray-100"
          onScroll={handleLeftScroll}
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

            {/* Line boundary overlays */}
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
                      fill={isActive ? 'rgba(59, 130, 246, 0.2)' : 'rgba(59, 130, 246, 0.05)'}
                      stroke={isActive ? 'rgba(59, 130, 246, 0.8)' : 'rgba(59, 130, 246, 0.3)'}
                      strokeWidth={isActive ? 2 : 1}
                      className="transition-colors cursor-pointer"
                      style={{ pointerEvents: 'auto' }}
                      onClick={() => onLineChange(index)}
                    />
                  );
                })}

                {/* Draw baseline indicators */}
                {lineData.map((line, index) => {
                  if (!line.baseline || line.baseline.length < 2) return null;
                  
                  const scale = imageDimensions.height / imageDimensions.naturalHeight;
                  const points = line.baseline
                    .map(p => `${p[0] * scale},${p[1] * scale}`)
                    .join(' ');
                  
                  const isActive = currentLine === index;
                  
                  return (
                    <polyline
                      key={`baseline-${index}`}
                      points={points}
                      fill="none"
                      stroke={isActive ? 'rgba(220, 38, 38, 0.8)' : 'rgba(220, 38, 38, 0.4)'}
                      strokeWidth={isActive ? 2 : 1}
                      strokeDasharray={isActive ? '0' : '4,2'}
                    />
                  );
                })}
              </svg>
            )}

            {/* Line number markers on left edge */}
            {imageLoaded && lineData.map((_, index) => {
              const pos = getLinePosition(index);
              const isActive = currentLine === index;
              
              return (
                <div
                  key={`marker-${index}`}
                  className={`absolute left-1 px-1.5 py-0.5 text-xs font-medium rounded cursor-pointer transition-colors
                    ${isActive 
                      ? 'bg-blue-600 text-white' 
                      : 'bg-white/90 text-gray-600 hover:bg-blue-100'
                    }`}
                  style={{ top: pos.top + (pos.height / 2) - 10 }}
                  onClick={() => onLineChange(index)}
                >
                  {index + 1}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right pane: Transcription editor aligned to image lines */}
        <div 
          ref={rightPaneRef}
          className="w-1/2 overflow-auto bg-white"
          onScroll={handleRightScroll}
        >
          {/* Container with same height as image to enable proper scroll sync */}
          <div 
            className="relative"
            style={{ height: contentHeight || 'auto', minHeight: '100%' }}
          >
            {imageLoaded && lines.map((line, index) => {
              const pos = getLinePosition(index);
              const isActive = currentLine === index;
              const comparison = comparisonByLine?.[index];

              return (
                <div
                  key={line.id || index}
                  className={`absolute left-0 right-0 flex items-center gap-2 px-2 transition-colors
                    ${isActive ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                  style={{
                    top: pos.top,
                    height: pos.height,
                  }}
                >
                  {/* Line number */}
                  <span 
                    className={`flex-shrink-0 w-8 text-center text-xs font-medium rounded cursor-pointer
                      ${isActive ? 'bg-blue-600 text-white' : 'text-gray-500'}`}
                    onClick={() => onLineChange(index)}
                  >
                    {index + 1}
                  </span>

                  {/* Transcription input with horizontal scroll */}
                  <div className="flex-1 overflow-x-auto overflow-y-hidden h-full flex items-center">
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
                      className={`w-full min-w-[200px] px-2 text-base font-hebrew rounded border
                        transition-all focus:outline-none focus:ring-2 focus:ring-blue-500
                        ${isActive 
                          ? 'border-blue-300 bg-white' 
                          : 'border-transparent bg-transparent hover:border-gray-200'
                        }
                        ${readOnly ? 'cursor-default' : ''}
                      `}
                      style={{ 
                        height: Math.max(24, pos.height - 8),
                        minHeight: 24,
                      }}
                      dir="rtl"
                      placeholder={readOnly ? '' : 'Enter transcription...'}
                      aria-label={`Line ${index + 1} transcription`}
                    />
                  </div>

                  {/* Model-vs-manual CER (and optional distance) */}
                  {showConfidence && comparison != null && (
                    <span
                      className="flex-shrink-0 text-xs text-gray-600 px-1"
                      title={`Edit distance: ${comparison.distance}`}
                    >
                      CER: {Math.round(comparison.cer * 100)}% ({comparison.distance})
                    </span>
                  )}
                </div>
              );
            })}

            {/* Show message if no lines */}
            {(!imageLoaded || lines.length === 0) && (
              <div className="absolute inset-0 flex items-center justify-center text-gray-500">
                {!imageLoaded ? 'Loading...' : 'No lines detected. Run line detection first.'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
