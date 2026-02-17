import { 
  Document, 
  Page, 
  Transcription, 
  TranscriptionLine,
  Model,
  Task,
  DocumentListResponse,
  PageListResponse,
} from '../types';

const API_BASE = '/api';

async function fetchApi<T>(
  url: string, 
  options?: RequestInit
): Promise<T> {
  // In browsers, relative URLs are fine. In test/Node environments, fetch requires absolute URLs.
  const fullUrl = new URL(`${API_BASE}${url}`, window.location.origin).toString();
  const response = await fetch(fullUrl, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }
  
  return response.json();
}

// Documents
export async function getDocuments(offset = 0, limit = 20): Promise<DocumentListResponse> {
  return fetchApi(`/documents?offset=${offset}&limit=${limit}`);
}

export async function getDocument(id: number): Promise<Document> {
  return fetchApi(`/documents/${id}`);
}

export async function updateDocument(id: number, update: Partial<Pick<Document, 'name' | 'shelfmark' | 'repository' | 'metadata'>>): Promise<Document> {
  return fetchApi(`/documents/${id}`, {
    method: 'PUT',
    body: JSON.stringify(update),
  });
}

export async function uploadDocument(file: File, name?: string): Promise<Document> {
  const formData = new FormData();
  formData.append('file', file);
  if (name) formData.append('name', name);
  
  const response = await fetch(`${API_BASE}/documents/upload`, {
    method: 'POST',
    body: formData,
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Upload failed' }));
    throw new Error(error.message);
  }
  
  return response.json();
}

export async function deleteDocument(id: number): Promise<void> {
  await fetchApi(`/documents/${id}`, { method: 'DELETE' });
}

// Import
export async function importTextFile(
  documentId: number,
  file: Blob | string,
  filename: string = 'import.txt'
): Promise<{ imported_pages: number[]; warnings: string[] }> {
  const formData = new FormData();
  formData.append('document_id', documentId.toString());
  const blob = typeof file === 'string' ? new Blob([file], { type: 'text/plain' }) : file;
  formData.append('file', blob, filename);
  const response = await fetch(`${API_BASE}/import/text`, {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Import failed' }));
    throw new Error(error.message || 'Import failed');
  }
  return response.json();
}

// Pages
export async function getDocumentPages(documentId: number, offset = 0, limit = 50): Promise<PageListResponse> {
  return fetchApi(`/documents/${documentId}/pages?offset=${offset}&limit=${limit}`);
}

export async function getPage(pageId: number): Promise<Page> {
  return fetchApi(`/pages/${pageId}`);
}

export async function getPageLines(pageId: number): Promise<{ lines: any[]; display_order: number[] }> {
  return fetchApi(`/pages/${pageId}/lines`);
}

export async function detectLines(pageId: number, modelId?: number): Promise<{ line_count: number }> {
  return fetchApi(`/pages/${pageId}/detect-lines${modelId ? `?model_id=${modelId}` : ''}`, {
    method: 'POST',
  });
}

export async function setGroundTruth(pageId: number, isGroundTruth: boolean): Promise<void> {
  await fetchApi(`/pages/${pageId}/ground-truth?is_ground_truth=${isGroundTruth}`, {
    method: 'PUT',
  });
}

export async function addPageToDocument(documentId: number, file: File, pageNumber?: number): Promise<Page> {
  const formData = new FormData();
  formData.append('file', file);
  if (pageNumber !== undefined) formData.append('page_number', pageNumber.toString());
  
  const response = await fetch(`${API_BASE}/documents/${documentId}/pages`, {
    method: 'POST',
    body: formData,
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to add page' }));
    throw new Error(error.message);
  }
  
  return response.json();
}

export async function deletePage(pageId: number): Promise<void> {
  await fetchApi(`/pages/${pageId}`, { method: 'DELETE' });
}

// Transcriptions
export async function getTranscription(pageId: number, type: 'manual' | 'model'): Promise<Transcription> {
  return fetchApi(`/pages/${pageId}/transcriptions/${type}`);
}

export async function updateTranscription(pageId: number, lines: TranscriptionLine[]): Promise<Transcription> {
  return fetchApi(`/pages/${pageId}/transcriptions/manual`, {
    method: 'PUT',
    body: JSON.stringify({ lines }),
  });
}

export async function copyModelToManual(pageId: number): Promise<Transcription> {
  return fetchApi(`/pages/${pageId}/transcriptions/copy-to-manual`, {
    method: 'POST',
  });
}

export async function getTranscriptionVersions(pageId: number, type: 'manual' | 'model', includeSnapshot: boolean = true): Promise<any[]> {
  return fetchApi<any[]>(`/pages/${pageId}/transcriptions/${type}/versions?include_snapshot=${includeSnapshot}`);
}

export async function restoreVersion(pageId: number, versionId: number): Promise<Transcription> {
  return fetchApi(`/pages/${pageId}/transcriptions/restore/${versionId}`, {
    method: 'POST',
  });
}

// Models
export async function getModels(): Promise<{ items: Model[] }> {
  return fetchApi('/models');
}

export async function addModel(data: { name: string; path: string; type: string; description?: string }): Promise<Model> {
  return fetchApi('/models', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function setDefaultModel(modelId: number): Promise<void> {
  await fetchApi(`/models/${modelId}/default`, { method: 'PUT' });
}

export async function deleteModel(modelId: number): Promise<void> {
  await fetchApi(`/models/${modelId}`, { method: 'DELETE' });
}

// Training/Fine-tuning
export async function startFineTuning(data: {
  model_id: number;
  name: string;
  page_ids?: number[];
}): Promise<{ task_id: string; status: string; training_pages: number }> {
  return fetchApi('/training/finetune', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getGroundTruthPages(): Promise<{ count: number; minimum_required: number; pages: Array<{ id: number; document_id: number; page_number: number }> }> {
  return fetchApi('/training/ground-truth-pages');
}

// Inference
export async function runInference(pageIds: number[], modelId?: number): Promise<{ task_id: string }> {
  return fetchApi<{ task_id: string }>('/inference/run', {
    method: 'POST',
    body: JSON.stringify({ page_ids: pageIds, model_id: modelId }),
  });
}

// Tasks
export async function getTaskStatus(taskId: string): Promise<Task> {
  return fetchApi(`/tasks/${taskId}/status`);
}

export async function getTasks(params?: {
  status?: string;
  type?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: Task[]; total: number; offset: number; limit: number }> {
  const queryParams = new URLSearchParams();
  if (params?.status) queryParams.append('status', params.status);
  if (params?.type) queryParams.append('task_type', params.type);
  if (params?.limit) queryParams.append('limit', params.limit.toString());
  if (params?.offset) queryParams.append('offset', params.offset.toString());
  
  const query = queryParams.toString();
  return fetchApi(`/tasks${query ? `?${query}` : ''}`);
}

export async function cancelTask(taskId: string): Promise<void> {
  await fetchApi(`/tasks/${taskId}`, { method: 'DELETE' });
}

// Export
export async function exportDocument(
  documentId: number,
  format: string,
  type: 'manual' | 'model',
  encoding: string = 'utf-8-sig',
  lineEnding: string = 'lf'
): Promise<Blob> {
  const response = await fetch(
    `${API_BASE}/export/${documentId}?format=${format}&type=${type}&encoding=${encoding}&line_ending=${lineEnding}`
  );
  
  if (!response.ok) {
    throw new Error('Export failed');
  }
  
  return response.blob();
}

export async function exportSelectedPages(
  pageIds: number[],
  format: string,
  type: 'manual' | 'model',
  encoding: string = 'utf-8-sig',
  lineEnding: string = 'lf'
): Promise<Blob> {
  if (!pageIds.length) {
    throw new Error('No page ids provided');
  }

  const idsParam = pageIds.join(',');
  const response = await fetch(
    `${API_BASE}/export/pages/export?ids=${encodeURIComponent(
      idsParam
    )}&format=${format}&type=${type}&encoding=${encoding}&line_ending=${lineEnding}`
  );

  if (!response.ok) {
    throw new Error('Export failed');
  }

  return response.blob();
}

// Backup
export async function downloadBackup(): Promise<Blob> {
  const response = await fetch(`${API_BASE}/backup/export`);
  
  if (!response.ok) {
    throw new Error('Backup failed');
  }
  
  return response.blob();
}
