import { useEffect, useRef, useCallback, useState } from 'react';
import OpenSeadragon from 'openseadragon';

interface LineData {
  line_number: number;
  baseline: number[][];
  boundary: number[][];
}

interface ImageViewerProps {
  imageUrl: string;
  tilesUrl?: string;
  lines: LineData[];
  currentLine: number;
  onLineClick?: (lineIndex: number) => void;
  showOverlays?: boolean;
}

// Custom navigation button component
function NavButton({ 
  onClick, 
  title, 
  children 
}: { 
  onClick: () => void; 
  title: string; 
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="p-2 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 
                 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1
                 transition-colors duration-150"
      aria-label={title}
    >
      {children}
    </button>
  );
}

export function ImageViewer({
  imageUrl,
  tilesUrl,
  lines,
  currentLine,
  onLineClick,
  showOverlays = true,
}: ImageViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<OpenSeadragon.Viewer | null>(null);
  const overlayRef = useRef<SVGSVGElement | null>(null);
  const drawOverlaysRef = useRef<() => void>(() => {}); // Ref to hold current drawOverlays function
  const [isReady, setIsReady] = useState(false);
  
  // Navigation handlers
  const handleZoomIn = useCallback(() => {
    viewerRef.current?.viewport.zoomBy(1.5);
  }, []);
  
  const handleZoomOut = useCallback(() => {
    viewerRef.current?.viewport.zoomBy(0.67);
  }, []);
  
  const handleHome = useCallback(() => {
    viewerRef.current?.viewport.goHome();
  }, []);
  
  const handleFullPage = useCallback(() => {
    viewerRef.current?.setFullScreen(!viewerRef.current.isFullPage());
  }, []);
  
  // Draw line overlays
  const drawOverlays = useCallback(() => {
    if (!viewerRef.current || !overlayRef.current || !showOverlays) return;
    
    const viewer = viewerRef.current;
    const overlay = overlayRef.current;
    
    // Clear existing overlays
    while (overlay.firstChild) {
      overlay.removeChild(overlay.firstChild);
    }
    
    // Get viewport info
    const containerSize = viewer.container.getBoundingClientRect();
    overlay.setAttribute('width', String(containerSize.width));
    overlay.setAttribute('height', String(containerSize.height));
    
    // Draw each line
    lines.forEach((line, index) => {
      if (!line.boundary || line.boundary.length < 3) return;
      
      // Convert image coordinates to viewer coordinates
      const points = line.boundary.map((point) => {
        const viewportPoint = viewer.viewport.imageToViewerElementCoordinates(
          new OpenSeadragon.Point(point[0], point[1])
        );
        return `${viewportPoint.x},${viewportPoint.y}`;
      }).join(' ');
      
      const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      polygon.setAttribute('points', points);
      polygon.setAttribute('class', `line-overlay ${index === currentLine ? 'active' : ''}`);
      polygon.setAttribute('data-line', String(index));
      
      // Make clickable
      if (onLineClick) {
        polygon.style.pointerEvents = 'auto';
        polygon.style.cursor = 'pointer';
        polygon.addEventListener('click', () => onLineClick(index));
      }
      
      overlay.appendChild(polygon);
    });
  }, [lines, currentLine, onLineClick, showOverlays]);
  
  // Keep ref updated with latest drawOverlays
  useEffect(() => {
    drawOverlaysRef.current = drawOverlays;
  }, [drawOverlays]);
  
  // Initialize OpenSeadragon
  useEffect(() => {
    if (!containerRef.current) return;
    
    const viewer = OpenSeadragon({
      element: containerRef.current,
      tileSources: tilesUrl ? {
        type: 'image',
        url: tilesUrl,
      } : {
        type: 'image',
        url: imageUrl,
      },
      // Disable built-in controls - we use custom buttons
      showNavigationControl: false,
      showNavigator: true,
      navigatorPosition: 'BOTTOM_RIGHT',
      minZoomLevel: 0.5,
      maxZoomLevel: 10,
      visibilityRatio: 0.5,
      constrainDuringPan: true,
      // Better default zoom
      defaultZoomLevel: 0,
      homeFillsViewer: true,
    });
    
    viewerRef.current = viewer;
    
    // Create SVG overlay
    viewer.addHandler('open', () => {
      const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      overlay.setAttribute('style', 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none;');
      overlayRef.current = overlay;
      containerRef.current?.appendChild(overlay);
      
      // Initial draw (use ref to get latest function)
      drawOverlaysRef.current();
      setIsReady(true);
    });
    
    // Redraw on viewport change (use ref to always call latest function)
    viewer.addHandler('viewport-change', () => drawOverlaysRef.current());
    
    return () => {
      viewer.destroy();
      setIsReady(false);
    };
  }, [imageUrl, tilesUrl]);
  
  // Update overlays when lines or current line changes
  useEffect(() => {
    drawOverlays();
  }, [lines, currentLine, drawOverlays]);
  
  // Zoom to current line
  useEffect(() => {
    if (!viewerRef.current || currentLine < 0 || currentLine >= lines.length) return;
    
    const line = lines[currentLine];
    if (!line.boundary || line.boundary.length === 0) return;
    
    const viewer = viewerRef.current;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const source = (viewer as any).source;
    if (!source) return;
    
    // Calculate bounds
    const xs = line.boundary.map(p => p[0]);
    const ys = line.boundary.map(p => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    
    // Pan to line (don't zoom too much)
    const padding = 0.5;
    const width = (maxX - minX) / source.width;
    const height = (maxY - minY) / source.height;
    const rect = new OpenSeadragon.Rect(
      (minX / source.width) - (width * padding / 2),
      (minY / source.height) - (height * padding / 2),
      width * (1 + padding),
      height * (1 + padding)
    );
    
    viewer.viewport.fitBounds(rect, false);
  }, [currentLine, lines]);
  
  return (
    <div className="relative w-full h-full">
      {/* OpenSeadragon container */}
      <div
        ref={containerRef}
        className="osd-container w-full h-full"
        role="img"
        aria-label="Document page image"
      />
      
      {/* Custom navigation controls */}
      {isReady && (
        <div className="absolute top-3 left-3 flex flex-col gap-1 z-10">
          <NavButton onClick={handleZoomIn} title="Zoom in">
            <svg className="w-5 h-5 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
            </svg>
          </NavButton>
          
          <NavButton onClick={handleZoomOut} title="Zoom out">
            <svg className="w-5 h-5 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM13 10H7" />
            </svg>
          </NavButton>
          
          <NavButton onClick={handleHome} title="Reset view">
            <svg className="w-5 h-5 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
          </NavButton>
          
          <NavButton onClick={handleFullPage} title="Toggle fullscreen">
            <svg className="w-5 h-5 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
          </NavButton>
        </div>
      )}
    </div>
  );
}
