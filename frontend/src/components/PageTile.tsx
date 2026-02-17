import { useState, useRef, useEffect } from 'react';
import { Page } from '../types';
import { formatFilenameForDisplay } from '../utils/filename';

interface PageTileProps {
  page: Page;
  onSelect: () => void;
  onMenuAction?: (action: string) => void;
  inferenceProgress?: {
    status: 'pending' | 'processing' | 'completed' | 'failed';
    progress?: number; // 0-100
  };
}

export function PageTile({ page, onSelect, onMenuAction, inferenceProgress }: PageTileProps) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const formattedFilename = formatFilenameForDisplay(page.image_path, 18, true);
  
  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };
    
    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showMenu]);
  
  const statusLabel = [
    page.lines_detected && 'Lines detected',
    page.manual_transcription_percent > 0 && `${Math.round(page.manual_transcription_percent)}% transcribed`,
    page.has_model_transcription && 'Model transcription available',
    page.is_ground_truth && 'Marked as ground truth',
  ].filter(Boolean).join(', ');
  
  return (
    <article
      className="page-tile group overflow-visible relative"
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      aria-label={`Page ${page.page_number}. ${statusLabel || 'No transcription yet'}`}
    >
      <div className="aspect-[3/4] bg-gray-100 relative">
        <img
          src={page.thumbnail_url || `/api/pages/${page.id}/thumbnail`}
          alt=""
          aria-hidden="true"
          className="w-full h-full object-contain"
          loading="lazy"
        />
        
        {/* Inference progress bar at bottom */}
        {inferenceProgress && inferenceProgress.status !== 'completed' && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-gray-200" aria-hidden="true">
            <div
              className={`h-full transition-all duration-300 ${
                inferenceProgress.status === 'processing' ? 'bg-blue-500' : 'bg-gray-400'
              }`}
              style={{ width: `${inferenceProgress.progress || 0}%` }}
            />
          </div>
        )}
        
        {/* Inference checkmark when complete */}
        {inferenceProgress && inferenceProgress.status === 'completed' && (
          <div className="absolute top-2 right-2 bg-green-500 rounded-full p-1" aria-hidden="true" title="Inference completed">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        )}
        
        {/* Progress ring for transcription: top-aligned with hamburger, light green bg, dark green progress/check */}
        {page.manual_transcription_percent > 0 && !inferenceProgress && (
          <div className="absolute top-1 left-1" aria-hidden="true" data-testid="page-tile-progress-ring">
            <svg className="w-8 h-8 transform -rotate-90" viewBox="0 0 32 32">
              <circle cx="16" cy="16" r="12" fill="#dcfce7" />
              <circle
                cx="16"
                cy="16"
                r="12"
                stroke="#e5e7eb"
                strokeWidth="3"
                fill="none"
              />
              <circle
                cx="16"
                cy="16"
                r="12"
                stroke="#166534"
                strokeWidth="3"
                fill="none"
                strokeDasharray={`${Math.min(100, page.manual_transcription_percent) * 0.75} 75`}
              />
              {page.manual_transcription_percent >= 99.5 ? (
                <g data-testid="progress-ring-checkmark" transform="translate(16, 16) rotate(90)">
                  <path
                    fill="none"
                    stroke="#166534"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M -5 0 L -2 3 L 5 -4"
                  />
                </g>
              ) : (
                <text
                  x="16"
                  y="16"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="#166534"
                  fontSize="8"
                  fontWeight="600"
                >
                  {Math.round(page.manual_transcription_percent)}%
                </text>
              )}
            </svg>
          </div>
        )}
      </div>

      {/* Three-dot menu: absolute so it stays inside tile and does not shift with badges */}
      {onMenuAction && (
        <div ref={menuRef} className="absolute top-1 right-1 z-10" data-testid="page-tile-menu-wrapper">
          <button
            className="p-1 bg-stone-50 hover:bg-gray-100 rounded opacity-90 hover:opacity-100 transition-opacity"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setShowMenu(!showMenu);
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
            }}
            aria-label="Page options menu"
            aria-expanded={showMenu}
            aria-haspopup="true"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
            </svg>
          </button>

          {showMenu && (
            <div
              className="absolute right-0 top-full mt-1 w-40 bg-white border rounded shadow-lg z-20"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 text-red-600"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setShowMenu(false);
                  onMenuAction('delete');
                }}
              >
                Delete Page
              </button>
            </div>
          )}
        </div>
      )}
      
      <div className="p-2 flex items-start justify-between">
        <div className="flex flex-col min-w-0">
          <span className="font-medium" aria-hidden="true">{page.page_number}</span>
          {formattedFilename && (
            <span className="text-xs text-gray-400 truncate" title={formattedFilename.full}>
              {formattedFilename.label}
            </span>
          )}
        </div>
        
        <div className="flex gap-1 shrink-0">
          {page.lines_detected && (
            <span className="badge badge-blue cursor-help relative z-10" title="Lines detected" aria-label="Lines detected">L</span>
          )}
          {page.has_model_transcription && (
            <span className="badge badge-green cursor-help relative z-10" title="Model transcription" aria-label="Model transcription">M</span>
          )}
        </div>
      </div>
    </article>
  );
}
