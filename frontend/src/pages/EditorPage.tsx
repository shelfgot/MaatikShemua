import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useDocumentStore } from '../store/documentStore';
import { ImageViewer } from '../components/ImageViewer';
import { TranscriptionEditor } from '../components/TranscriptionEditor';
import { SyncedSplitView } from '../components/SyncedSplitView';
import { useAutoSave } from '../hooks/useAutoSave';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useAnnouncer } from '../hooks/useAnnouncer';
import { TranscriptionLine } from '../types';
import * as api from '../services/api';
import { comparisonStats } from '../utils/levenshtein';

export default function EditorPage() {
  const { documentId, pageId } = useParams<{ documentId: string; pageId: string }>();
  const navigate = useNavigate();
  const { announce } = useAnnouncer();
  
  const {
    currentPage,
    manualTranscription,
    modelTranscription,
    lineData,
    fetchDocument,
    fetchPage,
    fetchTranscription,
    fetchLineData,
    updateTranscription,
  } = useDocumentStore();
  
  const [viewMode, setViewMode] = useState<'manual' | 'model'>('manual');
  const [layoutMode, setLayoutMode] = useState<'synced' | 'split'>('synced');
  const [syncEnabled, setSyncEnabled] = useState(true);
  const [currentLine, setCurrentLine] = useState(0);
  const [lines, setLines] = useState<TranscriptionLine[]>([]);
  const [modelVersions, setModelVersions] = useState<any[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);
  
  // Helper function to compare transcription content
  const compareTranscriptionContent = (lines1: TranscriptionLine[] | undefined, lines2: any[] | undefined): boolean => {
    if (!lines1 || !lines2 || lines1.length !== lines2.length) {
      return false;
    }
    return lines1.every((line, i) => {
      const otherLine = lines2[i];
      return (
        line.line_number === otherLine.line_number &&
        (line.text || '') === (otherLine.text || '') &&
        (line.confidence || null) === (otherLine.confidence || null)
      );
    });
  };
  
  // Filter out versions that match current transcription
  const filteredModelVersions = modelTranscription?.lines
    ? modelVersions.filter(version => {
        if (!version.lines_snapshot) return true; // Keep versions without snapshots
        return !compareTranscriptionContent(modelTranscription.lines, version.lines_snapshot);
      })
    : modelVersions;
  
  // Load data
  useEffect(() => {
    if (documentId && pageId) {
      const docId = parseInt(documentId);
      const pgId = parseInt(pageId);
      
      fetchDocument(docId);
      fetchPage(pgId);
      fetchLineData(pgId);
      fetchTranscription(pgId, 'manual');
      fetchTranscription(pgId, 'model');
      
      // Load model transcription versions
      const loadVersions = async () => {
        try {
          const versions = await api.getTranscriptionVersions(pgId, 'model', true);
          setModelVersions(versions);
          setSelectedVersionId(null); // Reset to current version
        } catch (err) {
          console.error('Failed to load model versions:', err);
        }
      };
      loadVersions();
    }
  }, [documentId, pageId, fetchDocument, fetchPage, fetchLineData, fetchTranscription]);
  
  // Reload model transcription and versions when model transcription changes
  useEffect(() => {
    if (pageId && modelTranscription) {
      // Reload versions when model transcription updates
      api.getTranscriptionVersions(parseInt(pageId), 'model', true).then(versions => {
        setModelVersions(versions);
        // If we were viewing a version and it's no longer available (or matches current), reset to current
        if (selectedVersionId !== null) {
          const version = versions.find(v => v.id === selectedVersionId);
          if (!version || (version.lines_snapshot && compareTranscriptionContent(modelTranscription.lines, version.lines_snapshot))) {
            setSelectedVersionId(null);
          }
        }
      }).catch(err => {
        console.error('Failed to reload model versions:', err);
      });
    }
  }, [pageId, modelTranscription?.updated_at, selectedVersionId, modelTranscription?.lines]);
  
  // Initialize lines from segmentation (line data), then fill with transcription text
  // Lines are ALWAYS dictated by segmentation, transcription is just the text content
  useEffect(() => {
    if (!lineData?.lines || lineData.lines.length === 0) {
      setLines([]);
      return;
    }
    
    // Get transcription based on view mode
    let transcriptionLines: TranscriptionLine[] | undefined;
    
    if (viewMode === 'manual') {
      transcriptionLines = manualTranscription?.lines;
    } else {
      // If viewing a specific version, use that; otherwise use current model transcription
      if (selectedVersionId !== null) {
        const version = modelVersions.find(v => v.id === selectedVersionId);
        transcriptionLines = version?.lines_snapshot?.map((l: any) => ({
          id: 0,
          line_number: l.line_number,
          text: l.text || '',
          confidence: l.confidence,
          notes: l.notes,
        }));
      } else {
        transcriptionLines = modelTranscription?.lines;
      }
    }
    
    // Create lines from segmentation, filling in text from transcription
    const newLines = lineData.lines.map((_, i) => {
      // Find matching transcription line by line_number
      const transLine = transcriptionLines?.find(l => l.line_number === i);
      return {
        id: transLine?.id || 0,
        line_number: i,
        text: transLine?.text || '',
        confidence: transLine?.confidence,
        notes: transLine?.notes,
      };
    });
    
    setLines(newLines);
  }, [viewMode, manualTranscription, modelTranscription, lineData, selectedVersionId, modelVersions]);

  // Per-line model-vs-manual comparison (CER + distance) when in model view
  const comparisonByLine = useMemo(() => {
    if (viewMode !== 'model' || !manualTranscription?.lines || lines.length === 0) {
      return null;
    }
    return lines.map((modelLine, i) => {
      const manualLine = manualTranscription.lines.find((l) => l.line_number === i);
      const manualText = (manualLine?.text ?? '').trim();
      if (manualText === '') return null;
      const modelText = (modelLine?.text ?? '').trim();
      return comparisonStats(manualText, modelText);
    });
  }, [viewMode, manualTranscription?.lines, lines]);

  // Auto-save hook
  const handleSave = useCallback(async (linesToSave: TranscriptionLine[]) => {
    if (!pageId) return;
    await updateTranscription(parseInt(pageId), linesToSave);
  }, [pageId, updateTranscription]);
  
  const { save, forceSave, lastSaved, isSaving, hasUnsavedChanges, getBackup, clearBackup } = useAutoSave({
    pageId: parseInt(pageId || '0'),
    onSave: handleSave,
  });
  
  // Check for backup on mount
  useEffect(() => {
    const backup = getBackup();
    if (backup) {
      const shouldRestore = window.confirm(
        `Found unsaved changes from ${new Date(backup.timestamp).toLocaleString()}. Restore?`
      );
      if (shouldRestore) {
        setLines(backup.lines);
        announce('Restored from backup');
      } else {
        clearBackup();
      }
    }
  }, [getBackup, clearBackup, announce]);
  
  // Handle line changes
  const handleLinesChange = useCallback((newLines: TranscriptionLine[]) => {
    setLines(newLines);
    if (viewMode === 'manual') {
      save(newLines);
    }
  }, [viewMode, save]);
  
  
  // Copy model to manual
  const handleCopyToManual = useCallback(async () => {
    if (!pageId) return;
    try {
      await api.copyModelToManual(parseInt(pageId));
      await fetchTranscription(parseInt(pageId), 'manual');
      setViewMode('manual');
      announce('Model transcription copied to manual');
    } catch (error) {
      announce('Failed to copy transcription', 'assertive');
    }
  }, [pageId, fetchTranscription, announce]);
  
  // Keyboard shortcuts
  useKeyboardShortcuts({
    'Ctrl+s': () => forceSave(lines),
    'Ctrl+m': () => setViewMode(v => v === 'manual' ? 'model' : 'manual'),
    'Ctrl+l': () => setLayoutMode(l => l === 'synced' ? 'split' : 'synced'),
    'Ctrl+k': () => setSyncEnabled(s => !s), // Toggle sync
    'Escape': () => navigate(`/document/${documentId}`),
    'Ctrl+ArrowUp': () => setCurrentLine(l => Math.max(0, l - 1)),
    'Ctrl+ArrowDown': () => setCurrentLine(l => Math.min(lines.length - 1, l + 1)),
  });
  
  if (!currentPage) {
    return <div>Loading...</div>;
  }
  
  return (
    <div className="h-[calc(100vh-8rem)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate(`/document/${documentId}`)}
            className="text-blue-600 hover:text-blue-800"
          >
            ← Back
          </button>
          <h2 className="text-lg font-medium">
            Page {currentPage.page_number}
          </h2>
        </div>
        
        <div className="flex items-center gap-4">
          {/* Layout toggle */}
          <div className="flex border rounded overflow-hidden">
            <button
              onClick={() => setLayoutMode('synced')}
              className={`px-3 py-1 text-sm flex items-center gap-1 ${layoutMode === 'synced' ? 'bg-gray-700 text-white' : 'hover:bg-gray-100'}`}
              title="Synced split view - baselines aligned (Ctrl+L)"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7" />
              </svg>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
            </button>
            <button
              onClick={() => setLayoutMode('split')}
              className={`px-3 py-1 text-sm ${layoutMode === 'split' ? 'bg-gray-700 text-white' : 'hover:bg-gray-100'}`}
              title="Independent split view"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7" />
              </svg>
            </button>
          </div>

          {/* View toggle */}
          <div className="flex border rounded overflow-hidden">
            <button
              onClick={() => {
                setViewMode('manual');
                setSelectedVersionId(null);
              }}
              className={`px-3 py-1 text-sm ${viewMode === 'manual' ? 'bg-blue-600 text-white' : ''}`}
            >
              Manual
            </button>
            <button
              onClick={() => {
                setViewMode('model');
                setSelectedVersionId(null);
              }}
              className={`px-3 py-1 text-sm ${viewMode === 'model' ? 'bg-blue-600 text-white' : ''}`}
              disabled={!modelTranscription?.lines.length}
            >
              Model
            </button>
          </div>
          
          {/* Model version selector (only show in model view mode when versions exist) */}
          {viewMode === 'model' && modelTranscription && (
            <select
              value={selectedVersionId || ''}
              onChange={(e) => setSelectedVersionId(e.target.value ? parseInt(e.target.value) : null)}
              className="px-3 py-1.5 text-sm border rounded"
              title={filteredModelVersions.length > 0 ? "View previous model predictions" : "No previous predictions"}
              disabled={filteredModelVersions.length === 0}
            >
              <option value="">
                Current{modelTranscription.updated_at ? ` (${new Date(modelTranscription.updated_at).toLocaleString()})` : ''}
              </option>
              {filteredModelVersions.map(version => (
                <option key={version.id} value={version.id}>
                  {version.change_summary} ({new Date(version.created_at).toLocaleString()})
                </option>
              ))}
            </select>
          )}
          
          {viewMode === 'model' && modelTranscription && (
            <button
              onClick={handleCopyToManual}
              className="px-3 py-1 text-sm border rounded hover:bg-gray-50"
            >
              Copy to Manual
            </button>
          )}
          
          {/* Save status */}
          <div className="text-sm text-gray-500">
            {isSaving && 'Saving...'}
            {!isSaving && hasUnsavedChanges && 'Unsaved changes'}
            {!isSaving && !hasUnsavedChanges && lastSaved && 
              `Saved ${lastSaved.toLocaleTimeString()}`
            }
          </div>
        </div>
      </div>
      
      {/* Editor view */}
      <div className="h-full border rounded-lg overflow-hidden">
        {layoutMode === 'synced' ? (
          /* Synced split view - side by side with aligned baselines and synced scrolling */
          <SyncedSplitView
            imageUrl={`/api/pages/${currentPage.id}/image`}
            lines={lines}
            lineData={lineData?.lines || []}
            onChange={handleLinesChange}
            currentLine={currentLine}
            onLineChange={setCurrentLine}
            readOnly={viewMode === 'model'}
            showConfidence={viewMode === 'model'}
            comparisonByLine={comparisonByLine ?? undefined}
            syncEnabled={syncEnabled}
            onSyncToggle={setSyncEnabled}
          />
        ) : (
          /* Independent split view - side by side without sync */
          <div className="flex h-full">
            {/* Image viewer */}
            <div className="w-1/2 border-r">
              <ImageViewer
                imageUrl={`/api/pages/${currentPage.id}/image`}
                lines={lineData?.lines || []}
                currentLine={currentLine}
                onLineClick={setCurrentLine}
              />
            </div>
            
            {/* Transcription editor */}
            <div className="w-1/2">
              <TranscriptionEditor
                lines={lines}
                lineData={lineData?.lines}
                onChange={handleLinesChange}
                currentLine={currentLine}
                onLineChange={setCurrentLine}
                readOnly={viewMode === 'model'}
                showConfidence={viewMode === 'model'}
                comparisonByLine={comparisonByLine ?? undefined}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
