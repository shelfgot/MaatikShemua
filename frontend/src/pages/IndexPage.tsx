import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useDocumentStore } from '../store/documentStore';
import { PageTile } from '../components/PageTile';
import { ProgressIndicator } from '../components/ProgressIndicator';
import { BatchUploadModal, BatchUploadFileStatus } from '../components/BatchUploadModal';
import { useTaskPolling } from '../hooks/useWebSocket';
import { useAnnouncer } from '../hooks/useAnnouncer';
import { Model } from '../types';
import * as api from '../services/api';
import { hasPageMarkers, wrapTextForImport } from '../utils/textImport';
import { formatFilenameForDisplay } from '../utils/filename';
import { getTileInferenceProgress } from '../utils/inferenceProgress';
import { useRangeSelection } from '../hooks/useRangeSelection';

type ViewMode = 'grid' | 'list';

const DOC_VIEW_MODE_KEY = 'ms_docs_view_mode';
const PAGE_VIEW_MODE_KEY = 'ms_pages_view_mode';
const SELECTED_MODEL_KEY = 'ms_selected_model_id';

function getInitialViewMode(storageKey: string): ViewMode {
  if (typeof window === 'undefined') return 'grid';
  const ls = (window as any).localStorage;
  if (!ls || typeof ls.getItem !== 'function') return 'grid';
  const stored = ls.getItem(storageKey) as ViewMode | null;
  return stored === 'list' || stored === 'grid' ? stored : 'grid';
}

async function readFileText(file: File): Promise<string> {
  // jsdom doesn’t always implement File.text()
  if (typeof (file as any).text === 'function') {
    return (file as any).text();
  }
  return new Response(file).text();
}

export default function IndexPage() {
  const { documentId } = useParams<{ documentId?: string }>();
  const navigate = useNavigate();
  const { announce } = useAnnouncer();
  
  const {
    documents,
    currentDocument,
    pages,
    documentsLoading,
    pagesLoading,
    fetchDocuments,
    fetchDocument,
    fetchPages,
    setCurrentDocument,
  } = useDocumentStore();
  
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const { taskData } = useTaskPolling(taskId);
  const [inferencePageIds, setInferencePageIds] = useState<number[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<number | undefined>(undefined);
  const [isRenamingDoc, setIsRenamingDoc] = useState(false);
  const [docNameDraft, setDocNameDraft] = useState('');
  const [renamingListDocId, setRenamingListDocId] = useState<number | null>(null);
  const [renamingListDraft, setRenamingListDraft] = useState<string>('');
  const [showImportText, setShowImportText] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importTargetPage, setImportTargetPage] = useState<number>(1);
  const [importFileHasMarkers, setImportFileHasMarkers] = useState(false);
  const [importResult, setImportResult] = useState<{ imported_pages: number[]; warnings: string[] } | null>(null);
  const [importingText, setImportingText] = useState(false);
  const [importSelectionPages, setImportSelectionPages] = useState<number[]>([]);
  const [pendingUploadFiles, setPendingUploadFiles] = useState<File[] | null>(null);
  const [uploadMode, setUploadMode] = useState<'upload-document' | 'add-pages'>('upload-document');
  const [batchStatuses, setBatchStatuses] = useState<BatchUploadFileStatus[]>([]);
  const [batchIndex, setBatchIndex] = useState(0);
  const [uploadStopRequested, setUploadStopRequested] = useState(false);
  const [docViewMode, setDocViewMode] = useState<ViewMode>(() => getInitialViewMode(DOC_VIEW_MODE_KEY));
  const [pageViewMode, setPageViewMode] = useState<ViewMode>(() => getInitialViewMode(PAGE_VIEW_MODE_KEY));
  const [documentOptionsOpen, setDocumentOptionsOpen] = useState(false);
  const [moreActionsOpen, setMoreActionsOpen] = useState(false);
  const [detectAllLinesLoading, setDetectAllLinesLoading] = useState(false);
  const documentOptionsRef = useRef<HTMLDivElement>(null);
  const moreActionsRef = useRef<HTMLDivElement>(null);
  
  // Load documents and models on mount
  useEffect(() => {
    fetchDocuments();
    api.getModels().then(response => {
      const recognition = response.items.filter(m => m.type === 'recognition');
      setModels(recognition);
      let stored: string | null = null;
      try {
        if (typeof window !== 'undefined' && window.localStorage && typeof window.localStorage.getItem === 'function') {
          stored = window.localStorage.getItem(SELECTED_MODEL_KEY);
        }
      } catch (_) {}
      const parsed = stored ? parseInt(stored, 10) : NaN;
      if (parsed && recognition.some(m => m.id === parsed)) {
        setSelectedModelId(parsed);
      } else {
        const defaultModel = recognition.find(m => m.is_default);
        if (defaultModel) setSelectedModelId(defaultModel.id);
      }
    }).catch(err => console.error('Failed to load models:', err));
  }, [fetchDocuments]);

  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage && typeof window.localStorage.setItem === 'function' && selectedModelId !== undefined) {
        window.localStorage.setItem(SELECTED_MODEL_KEY, String(selectedModelId));
      }
    } catch (_) {}
  }, [selectedModelId]);

  // Close document options and more actions on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (documentOptionsRef.current && !documentOptionsRef.current.contains(e.target as Node)) {
        setDocumentOptionsOpen(false);
      }
      if (moreActionsRef.current && !moreActionsRef.current.contains(e.target as Node)) {
        setMoreActionsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Persist view modes
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const ls = (window as any).localStorage;
    if (!ls || typeof ls.setItem !== 'function') return;
    ls.setItem(DOC_VIEW_MODE_KEY, docViewMode);
  }, [docViewMode]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const ls = (window as any).localStorage;
    if (!ls || typeof ls.setItem !== 'function') return;
    ls.setItem(PAGE_VIEW_MODE_KEY, pageViewMode);
  }, [pageViewMode]);
  
  // Load document and pages when documentId changes
  useEffect(() => {
    if (documentId) {
      const id = parseInt(documentId);
      fetchDocument(id);
      fetchPages(id);
    } else {
      setCurrentDocument(null);
    }
  }, [documentId, fetchDocument, fetchPages, setCurrentDocument]);

  // Reset page list pagination when the document changes
  useEffect(() => {
    setPageListPage(1);
  }, [documentId]);
  
  // Refresh pages when inference task completes
  useEffect(() => {
    if (taskData?.status === 'completed' && currentDocument) {
      // Refresh pages to show updated model transcriptions
      fetchPages(currentDocument.id);
      // Clear task after a delay to show completion status
      setTimeout(() => {
        setTaskId(null);
        setInferencePageIds([]);
      }, 3000);
    } else if (taskData?.status === 'failed') {
      // Clear task on failure
      setTimeout(() => {
        setTaskId(null);
        setInferencePageIds([]);
      }, 3000);
    }
  }, [taskData, currentDocument, fetchPages]);

  const documentIds = documents.map((d) => d.id);
  const documentSelection = useRangeSelection(documentIds);
  
  const pageIds = pages.map((p) => p.id);
  const pageSelection = useRangeSelection(pageIds);
  const PAGE_LIST_PAGE_SIZE = 50;
  const [pageListPage, setPageListPage] = useState(1);
  
  const visiblePages =
    pageViewMode === 'list'
      ? pages.slice(0, pageListPage * PAGE_LIST_PAGE_SIZE)
      : pages;

  // Escape: clear selection or close menus (when in document view)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (documentOptionsOpen || moreActionsOpen) {
        setDocumentOptionsOpen(false);
        setMoreActionsOpen(false);
        e.preventDefault();
      } else if (currentDocument && pageViewMode === 'list' && pageSelection.selected.length > 0) {
        pageSelection.clear();
        e.preventDefault();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [currentDocument, pageViewMode, pageSelection.selected.length, documentOptionsOpen, moreActionsOpen, pageSelection.clear]);

  const startRename = useCallback(() => {
    if (!currentDocument) return;
    setDocNameDraft(currentDocument.name);
    setIsRenamingDoc(true);
  }, [currentDocument]);

  const cancelRename = useCallback(() => {
    setIsRenamingDoc(false);
    setDocNameDraft('');
  }, []);

  const commitRename = useCallback(async () => {
    if (!currentDocument) return;
    const nextName = docNameDraft.trim();
    if (!nextName || nextName === currentDocument.name) {
      cancelRename();
      return;
    }
    try {
      await api.updateDocument(currentDocument.id, { name: nextName });
      await fetchDocument(currentDocument.id);
      await fetchDocuments();
      announce('Document renamed');
    } catch (err) {
      console.error('Failed to rename document:', err);
      announce('Failed to rename document', 'assertive');
    } finally {
      cancelRename();
    }
  }, [currentDocument, docNameDraft, cancelRename, fetchDocument, fetchDocuments, announce]);

  const startRenameFromList = useCallback((docId: number, currentName: string) => {
    setRenamingListDocId(docId);
    setRenamingListDraft(currentName);
  }, []);

  const cancelRenameFromList = useCallback(() => {
    setRenamingListDocId(null);
    setRenamingListDraft('');
  }, []);

  const commitRenameFromList = useCallback(async () => {
    if (renamingListDocId == null) return;
    const nextName = renamingListDraft.trim();
    if (!nextName) {
      cancelRenameFromList();
      return;
    }
    try {
      await api.updateDocument(renamingListDocId, { name: nextName });
      await fetchDocuments();
      announce('Document renamed');
    } catch (err) {
      console.error('Failed to rename document:', err);
      announce('Failed to rename document', 'assertive');
    } finally {
      cancelRenameFromList();
    }
  }, [renamingListDocId, renamingListDraft, cancelRenameFromList, fetchDocuments, announce]);
  
  const openBatchUpload = useCallback(
    (files: FileList | null, mode: 'upload-document' | 'add-pages') => {
      if (!files || files.length === 0) return;
      const asArray = Array.from(files);
      setPendingUploadFiles(asArray);
      setUploadMode(mode);
      setBatchStatuses(
        asArray.map((f) => ({
          name: f.name,
          status: 'pending',
        })),
      );
      setBatchIndex(0);
      setUploadStopRequested(false);
      setShowUpload(mode === 'upload-document');
    },
    [],
  );

  const runBatchUploads = useCallback(async () => {
    if (!pendingUploadFiles || pendingUploadFiles.length === 0) return;
    setUploading(true);

    try {
      if (uploadMode === 'upload-document') {
        // First file creates the document, the rest are additional pages.
        const [first, ...rest] = pendingUploadFiles;
        let createdDoc = null;

        // Upload first file
        setBatchIndex(1);
        try {
          createdDoc = await api.uploadDocument(first);
          setBatchStatuses((prev) => {
            const next = [...prev];
            next[0] = { ...next[0], status: 'ok' };
            return next;
          });
        } catch (err: any) {
          console.error('Failed to upload first document file:', err);
          setBatchStatuses((prev) => {
            const next = [...prev];
            next[0] = {
              ...next[0],
              status: 'error',
              errorMessage: err?.message || 'Upload failed',
            };
            return next;
          });
          announce('Failed to upload first file', 'assertive');
          return;
        }

        if (!createdDoc) {
          return;
        }

        // Add remaining files as pages, but do not stop on errors.
        let index = 1;
        let uploadedCount = 1; // first file already uploaded
        for (const file of rest) {
          if (uploadStopRequested) {
            break;
          }
          setBatchIndex(index + 1);
          try {
            await api.addPageToDocument(createdDoc.id, file);
            setBatchStatuses((prev) => {
              const next = [...prev];
              next[index] = { ...next[index], status: 'ok' };
              return next;
            });
            uploadedCount += 1;
          } catch (err: any) {
            console.error('Failed to add page file:', err);
            setBatchStatuses((prev) => {
              const next = [...prev];
              next[index] = {
                ...next[index],
                status: 'error',
                errorMessage: err?.message || 'Failed to add page',
              };
              return next;
            });
          }
          index += 1;
        }

        if (uploadStopRequested) {
          announce(
            `Upload canceled after ${uploadedCount} of ${pendingUploadFiles.length} file${pendingUploadFiles.length === 1 ? '' : 's'}`,
          );
        } else {
          announce(
            `Document uploaded: ${createdDoc.name} (${pendingUploadFiles.length} ${
              pendingUploadFiles.length === 1 ? 'page' : 'pages'
            })`,
          );
        }
        await fetchDocuments();
        navigate(`/document/${createdDoc.id}`);
      } else if (uploadMode === 'add-pages') {
        if (!currentDocument) return;

        let index = 0;
        let uploadedCount = 0;
        for (const file of pendingUploadFiles) {
          if (uploadStopRequested) {
            break;
          }
          setBatchIndex(index + 1);
          try {
            await api.addPageToDocument(currentDocument.id, file);
            setBatchStatuses((prev) => {
              const next = [...prev];
              next[index] = { ...next[index], status: 'ok' };
              return next;
            });
            uploadedCount += 1;
          } catch (err: any) {
            console.error('Failed to add page:', err);
            setBatchStatuses((prev) => {
              const next = [...prev];
              next[index] = {
                ...next[index],
                status: 'error',
                errorMessage: err?.message || 'Failed to add page',
              };
              return next;
            });
          }
          index += 1;
        }

        if (uploadStopRequested) {
          announce(
            `Upload canceled after ${uploadedCount} of ${pendingUploadFiles.length} file${pendingUploadFiles.length === 1 ? '' : 's'}`,
          );
        } else {
          announce(
            pendingUploadFiles.length === 1
              ? 'Page added'
              : `${pendingUploadFiles.length} pages added`,
          );
        }
        await fetchPages(currentDocument.id);
      }
    } finally {
      setUploading(false);
      setShowUpload(false);
      setPendingUploadFiles(null);
    }
  }, [
    announce,
    currentDocument,
    fetchDocuments,
    fetchPages,
    navigate,
    pendingUploadFiles,
    uploadMode,
    uploadStopRequested,
  ]);
  
  const handleDeletePage = useCallback(async (pageId: number) => {
    if (!confirm('Are you sure you want to delete this page?')) return;
    if (!currentDocument) return;
    
    try {
      await api.deletePage(pageId);
      announce('Page deleted');
      await fetchPages(currentDocument.id);
    } catch (error) {
      announce('Failed to delete page', 'assertive');
      console.error('Failed to delete page:', error);
    }
  }, [currentDocument, fetchPages, announce]);

  const handleDeleteDocument = useCallback(async () => {
    if (!currentDocument) return;
    if (!confirm('Are you sure you want to delete this document? This cannot be undone.')) return;
    try {
      await api.deleteDocument(currentDocument.id);
      announce('Document deleted');
      await fetchDocuments();
      setCurrentDocument(null);
      navigate('/');
    } catch (error) {
      announce('Failed to delete document', 'assertive');
      console.error('Failed to delete document:', error);
    }
  }, [currentDocument, announce, fetchDocuments, setCurrentDocument, navigate]);

  const handleImportText = useCallback(async () => {
    if (!currentDocument || !importFile) return;
    setImportingText(true);
    setImportResult(null);
    try {
      const raw = await readFileText(importFile);
      const wrapped = wrapTextForImport(raw, importFileHasMarkers ? undefined : importTargetPage);
      const res = await api.importTextFile(currentDocument.id, wrapped, importFile.name);
      setImportResult(res);
      announce('Text imported');
      await fetchPages(currentDocument.id);
    } catch (err) {
      console.error('Failed to import text:', err);
      announce('Failed to import text', 'assertive');
    } finally {
      setImportingText(false);
    }
  }, [currentDocument, importFile, importTargetPage, importFileHasMarkers, announce, fetchPages]);
  
  const handleDetectAllLines = useCallback(async () => {
    if (!currentDocument) return;
    
    const pageIds = pages.filter(p => !p.lines_detected).map(p => p.id);
    if (pageIds.length === 0) {
      announce('All pages already have lines detected');
      return;
    }
    
    setDetectAllLinesLoading(true);
    try {
      for (const pageId of pageIds) {
        await api.detectLines(pageId);
      }
      await fetchPages(currentDocument.id);
      announce(
        `Line detection completed for ${pageIds.length} page${pageIds.length === 1 ? '' : 's'} in "${currentDocument.name}"`,
      );
    } catch (error) {
      announce('Line detection failed', 'assertive');
    } finally {
      setDetectAllLinesLoading(false);
    }
  }, [currentDocument, pages, fetchPages, announce]);
  
  const handleRunInference = useCallback(async () => {
    if (!currentDocument) return;
    
    // Allow inference on all pages with detected lines (including those with existing predictions)
    const pageIds = pages.filter(p => p.lines_detected).map(p => p.id);
    if (pageIds.length === 0) {
      announce('No pages with detected lines available for inference');
      return;
    }
    
    try {
      const result = await api.runInference(pageIds, selectedModelId);
      setTaskId(result.task_id);
      setInferencePageIds(pageIds); // Track which pages are being processed
      announce(
        `Inference started for ${pageIds.length} page${pageIds.length === 1 ? '' : 's'} in "${currentDocument.name}"`,
      );
    } catch (error) {
      announce('Failed to start inference', 'assertive');
    }
  }, [currentDocument, pages, selectedModelId, announce]);
  
  const handleExport = useCallback(async (format: string) => {
    if (!currentDocument) return;
    
    try {
      const blob = await api.exportDocument(currentDocument.id, format, 'manual');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${currentDocument.name}.${format === 'text' ? 'txt' : format + '.xml'}`;
      a.click();
      URL.revokeObjectURL(url);
      announce('Export downloaded');
    } catch (error) {
      announce('Export failed', 'assertive');
    }
  }, [currentDocument, announce]);
  
  // Track inference progress per page
  const getPageInferenceProgress = useCallback((pageId: number) => {
    return getTileInferenceProgress(taskData, inferencePageIds, pageId);
  }, [taskData, inferencePageIds]);

  // Contextual primary CTA: next pipeline step
  const pipelineStep = !currentDocument
    ? null
    : pages.length === 0
      ? 'add_pages'
      : pages.some((p) => !p.lines_detected)
        ? 'detect_lines'
        : 'run_inference';

  const openImportText = useCallback(() => {
    setShowImportText(true);
    const selectedIds = pageSelection.selected.map((id) => Number(id));
    if (selectedIds.length > 0) {
      const numbers = pages
        .filter((p) => selectedIds.includes(p.id))
        .map((p) => p.page_number)
        .sort((a, b) => a - b);
      setImportSelectionPages(numbers);
      setImportTargetPage(numbers[0]);
    } else {
      setImportSelectionPages([]);
      setImportTargetPage(1);
    }
    setImportFile(null);
    setImportFileHasMarkers(false);
    setImportResult(null);
    setMoreActionsOpen(false);
  }, [pages, pageSelection.selected]);

  // Ctrl+Enter (or Cmd+Enter): trigger contextual primary action in document view
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!currentDocument || (e.ctrlKey !== true && e.metaKey !== true) || e.key !== 'Enter') return;
      if (showImportText || showUpload || pendingUploadFiles) return;
      e.preventDefault();
      if (pipelineStep === 'add_pages') {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.pdf,.tif,.tiff,.png,.jpg,.jpeg';
        input.multiple = true;
        input.onchange = (ev) => {
          const files = (ev.target as HTMLInputElement).files;
          if (files) openBatchUpload(files, 'add-pages');
        };
        input.click();
      } else if (pipelineStep === 'detect_lines') {
        handleDetectAllLines();
      } else if (pipelineStep === 'run_inference') {
        handleRunInference();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [currentDocument, showImportText, showUpload, pendingUploadFiles, pipelineStep, openBatchUpload, handleDetectAllLines, handleRunInference]);
  
  // Clear task when complete
  useEffect(() => {
    if (taskData?.status === 'completed') {
      if (currentDocument) {
        fetchPages(currentDocument.id);
      }
      // Keep checkmarks visible for a bit, then clear
      setTimeout(() => {
        setTaskId(null);
        setInferencePageIds([]);
      }, 5000);
    }
    if (taskData?.status === 'failed') {
      setTimeout(() => {
        setTaskId(null);
        setInferencePageIds([]);
      }, 3000);
    }
  }, [taskData, currentDocument, fetchPages]);
  
  return (
    <div>
      {/* Document selection or current document header */}
      {!currentDocument ? (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">Documents</h2>
            <div className="flex items-center gap-3">
              <div
                className="inline-flex rounded-md border border-gray-300 bg-white shadow-sm"
                role="group"
                aria-label="Document view mode"
              >
                <button
                  type="button"
                  className={`px-2 py-1 text-sm border-r border-gray-300 ${
                    docViewMode === 'grid'
                      ? 'bg-blue-50 text-blue-700 font-medium'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}
                  onClick={() => setDocViewMode('grid')}
                  aria-pressed={docViewMode === 'grid'}
                >
                  Tiles
                </button>
                <button
                  type="button"
                  className={`px-2 py-1 text-sm ${
                    docViewMode === 'list'
                      ? 'bg-blue-50 text-blue-700 font-medium'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}
                  onClick={() => setDocViewMode('list')}
                  aria-pressed={docViewMode === 'list'}
                >
                  List
                </button>
              </div>
              <button
                onClick={() => setShowUpload(true)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Upload Document
              </button>
            </div>
          </div>
          
          {documentsLoading ? (
            <p>Loading documents...</p>
          ) : documents.length === 0 ? (
            <p className="text-gray-500">No documents yet. Upload one to get started.</p>
          ) : (
            <>
              {docViewMode === 'grid' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {documents.map((doc) => (
                    <div
                      key={doc.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        if (renamingListDocId === doc.id) return;
                        navigate(`/document/${doc.id}`);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          if (renamingListDocId === doc.id) return;
                          navigate(`/document/${doc.id}`);
                        }
                      }}
                      className="text-left p-4 border rounded-lg hover:border-blue-500 hover:shadow-md transition-all cursor-pointer"
                      aria-label={`Document ${doc.name}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        {renamingListDocId === doc.id ? (
                          <input
                            aria-label={`Rename document ${doc.id}`}
                            className="font-medium border-b border-blue-300 focus:outline-none focus:border-blue-600 bg-transparent flex-1"
                            value={renamingListDraft}
                            autoFocus
                            onChange={(e) => setRenamingListDraft(e.target.value)}
                            onBlur={commitRenameFromList}
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                commitRenameFromList();
                              } else if (e.key === 'Escape') {
                                e.preventDefault();
                                cancelRenameFromList();
                              }
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <h3 className="font-medium">{doc.name}</h3>
                        )}
                        <button
                          type="button"
                          className="p-1 rounded hover:bg-gray-100 text-gray-600 hover:text-gray-900"
                          aria-label={`Rename ${doc.name}`}
                          title="Rename"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            startRenameFromList(doc.id, doc.name);
                          }}
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                            <path d="M17.414 2.586a2 2 0 00-2.828 0L6 11.172V14h2.828l8.586-8.586a2 2 0 000-2.828z" />
                            <path fillRule="evenodd" d="M4 16a1 1 0 001 1h10a1 1 0 100-2H6.414l-.707.707A1 1 0 015 16H4z" clipRule="evenodd" />
                          </svg>
                        </button>
                      </div>
                      <p className="text-sm text-gray-500">{doc.page_count} pages</p>
                      {doc.shelfmark && (
                        <p className="text-xs text-gray-400">{doc.shelfmark}</p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="border rounded-lg overflow-hidden">
                  {documentSelection.selected.length > 0 && (
                    <div className="flex items-center justify-between px-3 py-2 bg-blue-50 border-b border-blue-100 text-sm">
                      <span>{documentSelection.selected.length} selected</span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="px-2 py-1 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50"
                          onClick={() => documentSelection.clear()}
                        >
                          Clear selection
                        </button>
                        <button
                          type="button"
                          className="px-2 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-700"
                          onClick={async () => {
                            if (!confirm(`Delete ${documentSelection.selected.length} selected document(s)? This cannot be undone.`)) {
                              return;
                            }
                            try {
                              for (const id of documentSelection.selected) {
                                await api.deleteDocument(Number(id));
                              }
                              documentSelection.clear();
                              await fetchDocuments();
                              announce('Selected documents deleted');
                            } catch (error) {
                              console.error('Failed to delete selected documents:', error);
                              announce('Failed to delete selected documents', 'assertive');
                            }
                          }}
                        >
                          Delete selected
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-gray-700">Name</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-700">Pages</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-700">Shelfmark</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {documents.map((doc) => {
                          const selected = documentSelection.isSelected(doc.id);
                          return (
                            <tr
                              key={doc.id}
                              className={`${selected ? 'bg-blue-50' : 'bg-white hover:bg-gray-50'} cursor-pointer`}
                              onClick={(e) => documentSelection.onItemClick(doc.id, e)}
                              onDoubleClick={() => navigate(`/document/${doc.id}`)}
                              tabIndex={0}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  navigate(`/document/${doc.id}`);
                                }
                              }}
                            >
                              <td className="px-3 py-2 whitespace-nowrap">
                                <span className="font-medium">{doc.name}</span>
                              </td>
                              <td className="px-3 py-2 whitespace-nowrap text-gray-600">
                                {doc.page_count}
                              </td>
                              <td className="px-3 py-2 whitespace-nowrap text-gray-500">
                                {doc.shelfmark || '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="mb-6">
          {/* Row 1: Identity and document options */}
          <div className="flex items-center justify-between mb-3">
            <div>
              <button
                onClick={() => navigate('/')}
                className="text-blue-600 hover:text-blue-800 text-sm mb-1"
              >
                ← All Documents
              </button>
              {isRenamingDoc ? (
                <input
                  aria-label="Document name"
                  className="text-xl font-semibold border-b border-blue-300 focus:outline-none focus:border-blue-600 bg-transparent"
                  value={docNameDraft}
                  autoFocus
                  onChange={(e) => setDocNameDraft(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitRename();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      cancelRename();
                    }
                  }}
                />
              ) : (
                <div className="flex items-center gap-2">
                  <h2
                    className="text-xl font-semibold cursor-text"
                    onClick={startRename}
                    title="Click to rename document"
                  >
                    {currentDocument.name}
                  </h2>
                  <button
                    type="button"
                    className="btn-ghost p-1"
                    aria-label="Rename document"
                    title="Rename"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      startRename();
                    }}
                  >
                    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path d="M17.414 2.586a2 2 0 00-2.828 0L6 11.172V14h2.828l8.586-8.586a2 2 0 000-2.828z" />
                      <path fillRule="evenodd" d="M4 16a1 1 0 001 1h10a1 1 0 100-2H6.414l-.707.707A1 1 0 015 16H4z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
              )}
              {currentDocument.shelfmark && (
                <p className="text-sm text-gray-500">{currentDocument.shelfmark}</p>
              )}
            </div>
            <div className="relative" ref={documentOptionsRef}>
              <button
                type="button"
                className="btn-ghost p-2"
                onClick={() => setDocumentOptionsOpen((o) => !o)}
                aria-label="Document options"
                aria-expanded={documentOptionsOpen}
                aria-haspopup="true"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                </svg>
              </button>
              {documentOptionsOpen && (
                <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1">
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm text-red-700 hover:bg-red-50"
                    onClick={() => {
                      setDocumentOptionsOpen(false);
                      handleDeleteDocument();
                    }}
                  >
                    Delete Document
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Row 2: Actions and view – contextual primary, Model, Tiles/List, More */}
          <div className="flex flex-wrap items-center gap-3 border border-gray-200 rounded-lg bg-gray-50/50 px-3 py-2">
            {/* Contextual primary CTA */}
            {pipelineStep === 'add_pages' && (
              <button
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = '.pdf,.tif,.tiff,.png,.jpg,.jpeg';
                  input.multiple = true;
                  input.onchange = (e) => {
                    const files = (e.target as HTMLInputElement).files;
                    if (files) openBatchUpload(files, 'add-pages');
                  };
                  input.click();
                }}
                className="btn-primary"
                disabled={uploading}
              >
                Add Page
              </button>
            )}
            {pipelineStep === 'detect_lines' && (
              <button
                onClick={handleDetectAllLines}
                className="btn-primary"
                disabled={detectAllLinesLoading}
              >
                {detectAllLinesLoading ? 'Detecting…' : 'Detect All Lines'}
              </button>
            )}
            {pipelineStep === 'run_inference' && (
              <button
                onClick={handleRunInference}
                className="btn-primary"
                disabled={!!taskId || models.length === 0}
              >
                {taskId ? 'Running…' : 'Run Inference'}
              </button>
            )}

            <div className="border-l border-gray-200 pl-3" role="group" aria-label="Model and view">
              <select
                value={selectedModelId || ''}
                onChange={(e) => setSelectedModelId(e.target.value ? parseInt(e.target.value) : undefined)}
                className="select-toolbar mr-2"
                disabled={models.length === 0}
              >
                <option value="">Default Model</option>
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}{model.is_default ? ' (default)' : ''}
                  </option>
                ))}
              </select>
              <div
                className="inline-flex rounded-lg border border-gray-300 bg-white shadow-sm"
                role="group"
                aria-label="Page view mode"
              >
                <button
                  type="button"
                  className={`px-2.5 py-1.5 text-sm border-r border-gray-300 first:rounded-l-lg last:rounded-r-lg ${
                    pageViewMode === 'grid' ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-50'
                  }`}
                  onClick={() => {
                    pageSelection.clear();
                    setPageViewMode('grid');
                  }}
                  aria-pressed={pageViewMode === 'grid'}
                >
                  Tiles
                </button>
                <button
                  type="button"
                  className={`px-2.5 py-1.5 text-sm ${
                    pageViewMode === 'list' ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-50'
                  }`}
                  onClick={() => {
                    pageSelection.clear();
                    setPageViewMode('list');
                  }}
                  aria-pressed={pageViewMode === 'list'}
                >
                  List
                </button>
              </div>
            </div>

            {/* More actions */}
            <div className="relative ml-auto" ref={moreActionsRef}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setMoreActionsOpen((o) => !o)}
                aria-expanded={moreActionsOpen}
                aria-haspopup="true"
              >
                More actions ▼
              </button>
              {moreActionsOpen && (
                <div className="absolute right-0 top-full mt-1 w-52 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1">
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                    onClick={openImportText}
                  >
                    Import Text
                  </button>
                  {pipelineStep !== 'add_pages' && (
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                      onClick={() => {
                        setMoreActionsOpen(false);
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.accept = '.pdf,.tif,.tiff,.png,.jpg,.jpeg';
                        input.multiple = true;
                        input.onchange = (e) => {
                          const files = (e.target as HTMLInputElement).files;
                          if (files) openBatchUpload(files, 'add-pages');
                        };
                        input.click();
                      }}
                      disabled={uploading}
                    >
                      Add Page
                    </button>
                  )}
                  {pipelineStep !== 'detect_lines' && (
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                      onClick={() => {
                        setMoreActionsOpen(false);
                        handleDetectAllLines();
                      }}
                      disabled={detectAllLinesLoading}
                    >
                      {detectAllLinesLoading ? 'Detecting…' : 'Detect All Lines'}
                    </button>
                  )}
                  {pipelineStep !== 'run_inference' && (
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                      onClick={() => {
                        setMoreActionsOpen(false);
                        handleRunInference();
                      }}
                      disabled={!!taskId || !pages.some((p) => p.lines_detected) || models.length === 0}
                    >
                      {taskId ? 'Running…' : 'Run Inference'}
                    </button>
                  )}
                  <div className="border-t border-gray-100 pt-1 mt-1">
                    <span className="px-3 py-1 text-xs text-gray-500 block">Export document</span>
                    {['text', 'tei', 'alto', 'pagexml'].map((format) => (
                      <button
                        key={format}
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                        onClick={() => {
                          setMoreActionsOpen(false);
                          handleExport(format);
                        }}
                      >
                        {format === 'text' ? 'Text' : format === 'tei' ? 'TEI-XML' : format === 'alto' ? 'Alto XML' : 'PAGE XML'}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          
          {/* Page grid or list */}
          {pagesLoading ? (
            <p>Loading pages...</p>
          ) : pageViewMode === 'grid' ? (
            <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4">
              {pages.map((page) => (
                <PageTile
                  key={page.id}
                  page={page}
                  onSelect={() => navigate(`/document/${currentDocument.id}/page/${page.id}`)}
                  inferenceProgress={getPageInferenceProgress(page.id)}
                  onMenuAction={(action) => {
                    if (action === 'delete') {
                      handleDeletePage(page.id);
                    }
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              {pageSelection.selected.length > 0 && (
                <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 px-3 py-2 bg-blue-50 border-b border-blue-100 text-sm">
                  <span className="font-medium">{pageSelection.selected.length} selected</span>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="btn-secondary text-xs py-1 px-2"
                      onClick={() => pageSelection.clear()}
                    >
                      Clear selection
                    </button>
                    <button
                      type="button"
                      className="btn-destructive text-xs py-1 px-2"
                      onClick={async () => {
                        if (!currentDocument) return;
                        if (!confirm(`Delete ${pageSelection.selected.length} selected page(s)?`)) {
                          return;
                        }
                        try {
                          for (const id of pageSelection.selected) {
                            await api.deletePage(Number(id));
                          }
                          pageSelection.clear();
                          await fetchPages(currentDocument.id);
                          announce('Selected pages deleted');
                        } catch (error) {
                          console.error('Failed to delete selected pages:', error);
                          announce('Failed to delete selected pages', 'assertive');
                        }
                      }}
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      className="btn-secondary text-xs py-1 px-2"
                      onClick={async () => {
                        if (!currentDocument) return;
                        const ids = pageSelection.selected.map((id) => Number(id));
                        if (ids.length === 0) return;
                        try {
                          for (const id of ids) {
                            await api.detectLines(id);
                          }
                          await fetchPages(currentDocument.id);
                          announce(`Lines detected on ${ids.length} selected page(s)`);
                          pageSelection.clear();
                        } catch (error) {
                          console.error('Line detection failed for selected pages:', error);
                          announce('Line detection failed for selected pages', 'assertive');
                        }
                      }}
                    >
                      Detect lines
                    </button>
                    <button
                      type="button"
                      className="btn-primary text-xs py-1 px-2"
                      onClick={async () => {
                        if (!currentDocument) return;
                        const ids = pageSelection.selected.map((id) => Number(id));
                        if (ids.length === 0) return;
                        try {
                          const result = await api.runInference(ids, selectedModelId);
                          setTaskId(result.task_id);
                          setInferencePageIds(ids);
                          announce('Inference started for selected pages');
                          pageSelection.clear();
                        } catch (error) {
                          console.error('Failed to start inference for selected pages:', error);
                          announce('Failed to start inference for selected pages', 'assertive');
                        }
                      }}
                      disabled={!!taskId || pageSelection.selected.length === 0 || models.length === 0}
                    >
                      {taskId ? 'Running…' : 'Run inference'}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary text-xs py-1 px-2"
                      onClick={async () => {
                        const ids = pageSelection.selected.map((id) => Number(id));
                        if (ids.length === 0) return;
                        try {
                          for (const id of ids) {
                            await api.copyModelToManual(id);
                          }
                          if (currentDocument) {
                            await fetchPages(currentDocument.id);
                          }
                          announce('Copied model transcription to manual for selected pages');
                          pageSelection.clear();
                        } catch (error) {
                          console.error('Failed to copy model transcription for selected pages:', error);
                          announce('Failed to copy model transcription for selected pages', 'assertive');
                        }
                      }}
                    >
                      Copy model → manual
                    </button>
                    <div className="flex items-center gap-1">
                      <span className="text-gray-500 text-xs">Export</span>
                      <select
                        className="select-toolbar text-xs py-1 px-2"
                        defaultValue=""
                        onChange={async (e) => {
                          const value = e.target.value;
                          if (!value) return;
                          const ids = pageSelection.selected.map((id) => Number(id));
                          if (ids.length === 0) return;
                          try {
                            const blob = await api.exportSelectedPages(ids, value, 'manual');
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `pages-${ids.length}.${value === 'text' ? 'txt.zip' : value + '.xml.zip'}`;
                            a.click();
                            URL.revokeObjectURL(url);
                            announce('Export downloaded for selected pages');
                            pageSelection.clear();
                          } catch (error) {
                            console.error('Failed to export selected pages:', error);
                            announce('Failed to export selected pages', 'assertive');
                          } finally {
                            e.target.value = '';
                          }
                        }}
                      >
                        <option value="" disabled>
                          …
                        </option>
                        <option value="text">Text</option>
                        <option value="tei">TEI-XML</option>
                        <option value="alto">Alto XML</option>
                        <option value="pagexml">PAGE XML</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}
              <div className="overflow-x-auto">
                {pages.length > PAGE_LIST_PAGE_SIZE && (
                  <div className="flex items-center justify-between px-3 py-2 text-xs sm:text-sm text-gray-600 border-b border-gray-100">
                    <span>
                      Showing {visiblePages.length === 0 ? 0 : 1}–
                      {visiblePages.length} of {pages.length} pages
                    </span>
                  </div>
                )}
                <table className="min-w-full text-xs sm:text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-700">Page #</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-700">Filename</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-700">Status</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-700">% transcribed</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-700">Inference</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {visiblePages.map((page) => {
                      const selected = pageSelection.isSelected(page.id);
                      const formattedFilename = formatFilenameForDisplay(page.image_path, 18, true);
                      const inference = getPageInferenceProgress(page.id);
                      const statusFlags = [
                        page.lines_detected && 'L',
                        page.has_model_transcription && 'M',
                        page.is_ground_truth && '★',
                      ].filter(Boolean).join(' ');

                      return (
                        <tr
                          key={page.id}
                          className={`${selected ? 'bg-blue-50' : 'bg-white hover:bg-gray-50'} cursor-pointer`}
                          onClick={(e) => pageSelection.onItemClick(page.id, e)}
                          onDoubleClick={() => navigate(`/document/${currentDocument.id}/page/${page.id}`)}
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              navigate(`/document/${currentDocument.id}/page/${page.id}`);
                            }
                          }}
                        >
                          <td className="px-3 py-2 whitespace-nowrap">
                            <button
                              type="button"
                              className="text-blue-700 hover:underline"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/document/${currentDocument.id}/page/${page.id}`);
                              }}
                            >
                              {page.page_number}
                            </button>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap text-gray-700">
                            <span
                              className="truncate max-w-xs inline-block"
                              title={formattedFilename?.full || formattedFilename?.label || '—'}
                            >
                              {formattedFilename?.label || '—'}
                            </span>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap text-gray-700">
                            {statusFlags || '—'}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap text-gray-700">
                            {page.manual_transcription_percent
                              ? `${Math.round(page.manual_transcription_percent)}%`
                              : '0%'}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap text-gray-700">
                            {inference
                              ? inference.status === 'completed'
                                ? '✓ complete'
                                : `${Math.round(inference.progress || 0)}%`
                              : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {pages.length > visiblePages.length && (
                <div className="flex justify-center px-3 py-3 border-t border-gray-100 bg-white">
                  <button
                    type="button"
                    className="px-3 py-1.5 text-xs sm:text-sm border rounded hover:bg-gray-50"
                    onClick={() => setPageListPage((prev) => prev + 1)}
                  >
                    Load more ({Math.min(PAGE_LIST_PAGE_SIZE, pages.length - visiblePages.length)})
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Import text modal */}
      {showImportText && currentDocument && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="import-dialog-title"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setShowImportText(false);
            }
          }}
        >
          <div className="bg-white rounded-lg shadow-lg w-full max-w-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 id="import-dialog-title" className="text-lg font-semibold">Import manual transcription (.txt)</h3>
              <button
                className="text-gray-600 hover:text-gray-900"
                onClick={() => setShowImportText(false)}
                aria-label="Close import dialog"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1" htmlFor="import-txt">
                  Transcription txt
                </label>
                <input
                  id="import-txt"
                  aria-label="Transcription txt"
                  type="file"
                  accept=".txt"
                  className="block w-full text-sm"
                  onChange={async (e) => {
                    const f = e.target.files?.[0] || null;
                    setImportFile(f);
                    setImportResult(null);
                    if (f) {
                      const text = await readFileText(f);
                      setImportFileHasMarkers(hasPageMarkers(text));
                    } else {
                      setImportFileHasMarkers(false);
                    }
                  }}
                />
                <p className="text-xs text-gray-500 mt-1">
                  If your file includes <code>Page N</code> markers, it will map pages automatically.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1" htmlFor="import-target">
                  Target page
                </label>
                <select
                  id="import-target"
                  aria-label="Target page"
                  className="px-3 py-1.5 text-sm border rounded w-full"
                  value={importTargetPage}
                  onChange={(e) => setImportTargetPage(parseInt(e.target.value))}
                  disabled={importFileHasMarkers}
                >
                  {pages.map((p) => (
                    <option key={p.id} value={p.page_number}>
                      Page {p.page_number}
                    </option>
                  ))}
                </select>
                {importSelectionPages.length > 0 && (
                  <p className="text-xs text-gray-500 mt-1">
                    Selected pages:&nbsp;
                    {importSelectionPages.join(', ')}. Import will start at page {importTargetPage}.
                  </p>
                )}
                {importFileHasMarkers && (
                  <p className="text-xs text-gray-500 mt-1">Detected Page markers; target page is ignored.</p>
                )}
              </div>

              <div className="flex gap-2 justify-end">
                <button
                  className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50"
                  onClick={() => setShowImportText(false)}
                  disabled={importingText}
                >
                  Cancel
                </button>
                <button
                  className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-60"
                  onClick={handleImportText}
                  disabled={!importFile || importingText}
                >
                  Import
                </button>
              </div>

              {importResult && (
                <div className="text-sm bg-gray-50 border rounded p-2">
                  <div>
                    <strong>Imported pages:</strong> {importResult.imported_pages.join(', ') || 'None'}
                  </div>
                  {importResult.warnings.length > 0 && (
                    <div className="mt-1">
                      <strong>Warnings:</strong>
                      <ul className="list-disc ml-5">
                        {importResult.warnings.map((w, idx) => (
                          <li key={idx}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      
      {/* Upload modal */}
      {showUpload && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="upload-dialog-title"
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !uploading) {
              e.stopPropagation();
              setShowUpload(false);
            }
          }}
        >
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 id="upload-dialog-title" className="text-lg font-semibold mb-4">Upload Document</h3>
                  <input
                    type="file"
                    accept=".pdf,.tif,.tiff,.png,.jpg,.jpeg"
                    multiple
                    onChange={(e) => openBatchUpload(e.target.files, 'upload-document')}
                    disabled={uploading}
                    className="w-full"
                  />
                  <p className="text-sm text-gray-500 mt-2">
                    Supported formats: PDF, TIFF, PNG, JPEG. Select multiple files to upload as one
                    document.
                  </p>
                  <div className="flex justify-end gap-2 mt-4">
                    <button
                      onClick={() => setShowUpload(false)}
                      disabled={uploading}
                      className="px-4 py-2 text-gray-600 hover:text-gray-800"
                    >
                      Cancel
                    </button>
                  </div>
                  {uploading && <p className="mt-2">Uploading...</p>}
          </div>
        </div>
      )}
      <BatchUploadModal
        files={pendingUploadFiles}
        mode={uploadMode}
        isOpen={!!pendingUploadFiles}
        isUploading={uploading}
        currentIndex={batchIndex}
        total={pendingUploadFiles ? pendingUploadFiles.length : 0}
        perFileStatus={batchStatuses}
        onConfirm={runBatchUploads}
        onCancel={() => {
          if (uploading) return;
          setPendingUploadFiles(null);
          setBatchStatuses([]);
          setBatchIndex(0);
          setUploadStopRequested(false);
        }}
        onRequestStop={() => {
          setUploadStopRequested(true);
        }}
        isStopRequested={uploadStopRequested}
      />
      
      {/* Progress indicator */}
      <ProgressIndicator task={taskData} />
    </div>
  );
}
