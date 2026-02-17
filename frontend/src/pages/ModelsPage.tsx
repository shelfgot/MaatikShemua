import { useEffect, useState, useCallback } from 'react';
import { Model, Page } from '../types';
import * as api from '../services/api';
import { useAnnouncer } from '../hooks/useAnnouncer';
import { useTaskPolling } from '../hooks/useWebSocket';
import { ProgressIndicator } from '../components/ProgressIndicator';

export default function ModelsPage() {
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModel, setShowAddModel] = useState(false);
  const [showFineTune, setShowFineTune] = useState(false);
  const [selectedModel, setSelectedModel] = useState<Model | null>(null);
  const [availablePages, setAvailablePages] = useState<Page[]>([]);
  const [documentNamesById, setDocumentNamesById] = useState<Record<number, string>>({});
  const [selectedPageIds, setSelectedPageIds] = useState<number[]>([]);
  const [minimumRequiredPages, setMinimumRequiredPages] = useState<number>(1);
  const [trainingTaskId, setTrainingTaskId] = useState<string | null>(null);
  const { taskData: trainingTaskData } = useTaskPolling(trainingTaskId);
  const { announce } = useAnnouncer();
  
  const fetchModels = useCallback(async () => {
    try {
      const response = await api.getModels();
      setModels(response.items);
    } catch (error) {
      console.error('Failed to fetch models:', error);
    } finally {
      setLoading(false);
    }
  }, []);
  
  useEffect(() => {
    fetchModels();
  }, [fetchModels]);
  
  const fetchAvailablePages = useCallback(async () => {
    try {
      const response = await api.getGroundTruthPages();
      // Store minimum required pages from backend
      setMinimumRequiredPages(response.minimum_required || 1);
      // Backend returns simplified page objects, fetch full page details
      const fullPages = await Promise.all(
        (response.pages || []).map((p: any) => api.getPage(p.id))
      );
      setAvailablePages(fullPages);

      const docIds = Array.from(new Set(fullPages.map(p => p.document_id)));
      const docs = await Promise.all(docIds.map(id => api.getDocument(id)));
      const map: Record<number, string> = {};
      for (const d of docs as any[]) {
        if (d?.id != null) map[d.id] = d.name || `Document ${d.id}`;
      }
      setDocumentNamesById(map);
    } catch (error) {
      console.error('Failed to fetch ground truth pages:', error);
    }
  }, []);
  
  useEffect(() => {
    if (showFineTune) {
      fetchAvailablePages();
    }
  }, [showFineTune, fetchAvailablePages]);
  
  const handleStartFineTuning = useCallback(async (modelName: string) => {
    if (!selectedModel) return;
    if (selectedPageIds.length < minimumRequiredPages) {
      announce(`Need at least ${minimumRequiredPages} page${minimumRequiredPages !== 1 ? 's' : ''} for training`, 'assertive');
      return;
    }
    
    try {
      const result = await api.startFineTuning({
        model_id: selectedModel.id,
        name: modelName,
        page_ids: selectedPageIds,
      });
      setTrainingTaskId(result.task_id);
      setShowFineTune(false);
      announce(
        `Fine-tuning started for model "${selectedModel.name}" with ${result.training_pages} page${result.training_pages === 1 ? '' : 's'}`,
      );
    } catch (error: any) {
      announce(error.message || 'Failed to start fine-tuning', 'assertive');
    }
  }, [selectedModel, selectedPageIds, minimumRequiredPages, announce]);
  
  useEffect(() => {
    if (trainingTaskData?.status === 'completed') {
      fetchModels();
      setTimeout(() => {
        setTrainingTaskId(null);
        announce('Fine-tuning completed! New model available.');
      }, 3000);
    }
  }, [trainingTaskData, fetchModels, announce]);
  
  const handleSetDefault = useCallback(async (modelId: number) => {
    try {
      await api.setDefaultModel(modelId);
      await fetchModels();
      announce('Default model updated');
    } catch (error) {
      announce('Failed to set default model', 'assertive');
    }
  }, [fetchModels, announce]);
  
  const handleDelete = useCallback(async (modelId: number) => {
    if (!confirm('Are you sure you want to remove this model?')) return;
    
    try {
      await api.deleteModel(modelId);
      await fetchModels();
      announce('Model removed');
    } catch (error) {
      announce('Failed to remove model', 'assertive');
    }
  }, [fetchModels, announce]);
  
  const handleAddModel = useCallback(async (data: { name: string; path: string; type: string; description?: string }) => {
    try {
      await api.addModel(data);
      await fetchModels();
      setShowAddModel(false);
      announce('Model added');
    } catch (error) {
      announce('Failed to add model', 'assertive');
    }
  }, [fetchModels, announce]);
  
  const segmentationModels = models.filter(m => m.type === 'segmentation');
  const recognitionModels = models.filter(m => m.type === 'recognition');
  
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold">Model Management</h2>
        <button
          onClick={() => setShowAddModel(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Add Model
        </button>
      </div>
      
      {loading ? (
        <p>Loading models...</p>
      ) : (
        <>
          {/* Segmentation Models */}
          <section className="mb-8">
            <h3 className="text-lg font-medium mb-4">Segmentation Models</h3>
            {segmentationModels.length === 0 ? (
              <p className="text-gray-500">No segmentation models configured.</p>
            ) : (
              <div className="space-y-2">
                {segmentationModels.map(model => (
                  <ModelRow
                    key={model.id}
                    model={model}
                    onSetDefault={() => handleSetDefault(model.id)}
                    onDelete={() => handleDelete(model.id)}
                    onFineTune={() => {}}
                  />
                ))}
              </div>
            )}
          </section>
          
          {/* Recognition Models */}
          <section>
            <h3 className="text-lg font-medium mb-4">Recognition Models</h3>
            {recognitionModels.length === 0 ? (
              <p className="text-gray-500">No recognition models configured.</p>
            ) : (
              <div className="space-y-2">
                {recognitionModels.map(model => (
                  <ModelRow
                    key={model.id}
                    model={model}
                    onSetDefault={() => handleSetDefault(model.id)}
                    onDelete={() => handleDelete(model.id)}
                    onFineTune={() => {
                      setSelectedModel(model);
                      setShowFineTune(true);
                    }}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}
      
      {/* Add Model Modal */}
      {showAddModel && (
        <AddModelModal
          onClose={() => setShowAddModel(false)}
          onSubmit={handleAddModel}
        />
      )}
      
      {/* Fine-tuning Modal */}
      {showFineTune && selectedModel && (
        <FineTuneModal
          model={selectedModel}
          availablePages={availablePages}
          documentNamesById={documentNamesById}
          selectedPageIds={selectedPageIds}
          onPageToggle={(pageId) => {
            setSelectedPageIds(prev =>
              prev.includes(pageId)
                ? prev.filter(id => id !== pageId)
                : [...prev, pageId]
            );
          }}
          onBulkToggle={(pageIds, checked) => {
            setSelectedPageIds(prev => {
              if (checked) {
                const set = new Set(prev);
                for (const id of pageIds) set.add(id);
                return Array.from(set);
              }
              return prev.filter(id => !pageIds.includes(id));
            });
          }}
          onStart={handleStartFineTuning}
          onClose={() => {
            setShowFineTune(false);
            setSelectedModel(null);
            setSelectedPageIds([]);
          }}
          minimumRequired={minimumRequiredPages}
        />
      )}
      
      {/* Training progress */}
      <ProgressIndicator task={trainingTaskData} />
    </div>
  );
}

function ModelRow({ model, onSetDefault, onDelete, onFineTune }: {
  model: Model;
  onSetDefault: () => void;
  onDelete: () => void;
  onFineTune: () => void;
}) {
  return (
    <div className="flex items-center justify-between p-4 border rounded-lg">
      <div>
        <div className="flex items-center gap-2">
          <span className="font-medium">{model.name}</span>
          {model.is_default && (
            <span className="badge badge-green">Default</span>
          )}
        </div>
        <p className="text-sm text-gray-500">{model.path}</p>
        {model.description && (
          <p className="text-sm text-gray-400">{model.description}</p>
        )}
        <p className="text-xs text-gray-400">
          Kraken version: {model.kraken_version || 'Unknown'}
        </p>
      </div>
      
      <div className="flex gap-2">
        {model.type === 'recognition' && (
          <button
            onClick={onFineTune}
            className="text-sm text-purple-600 hover:text-purple-800"
          >
            Fine-tune
          </button>
        )}
        {!model.is_default && (
          <button
            onClick={onSetDefault}
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            Set Default
          </button>
        )}
        <button
          onClick={onDelete}
          className="text-sm text-red-600 hover:text-red-800"
        >
          Remove
        </button>
      </div>
    </div>
  );
}

function AddModelModal({ onClose, onSubmit }: {
  onClose: () => void;
  onSubmit: (data: { name: string; path: string; type: string; description?: string }) => void;
}) {
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [type, setType] = useState('recognition');
  const [description, setDescription] = useState('');
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ name, path, type, description: description || undefined });
  };
  
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
        <h3 className="text-lg font-semibold mb-4">Add Model</h3>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              className="w-full border rounded px-3 py-2"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">Path</label>
            <input
              type="text"
              value={path}
              onChange={e => setPath(e.target.value)}
              required
              placeholder="/app/models/my-model.mlmodel"
              className="w-full border rounded px-3 py-2"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">Type</label>
            <select
              value={type}
              onChange={e => setType(e.target.value)}
              className="w-full border rounded px-3 py-2"
            >
              <option value="recognition">Recognition (HTR)</option>
              <option value="segmentation">Segmentation (Line Detection)</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">Description (optional)</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full border rounded px-3 py-2"
              rows={2}
            />
          </div>
          
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-600 hover:text-gray-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Add Model
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function FineTuneModal({ model, availablePages, documentNamesById, selectedPageIds, onPageToggle, onBulkToggle, onStart, onClose, minimumRequired }: {
  model: Model;
  availablePages: Page[];
  documentNamesById: Record<number, string>;
  selectedPageIds: number[];
  onPageToggle: (pageId: number) => void;
  onBulkToggle: (pageIds: number[], checked: boolean) => void;
  onStart: (modelName: string) => void;
  onClose: () => void;
  minimumRequired: number;
}) {
  const [modelName, setModelName] = useState(`${model.name}_finetuned`);

  const grouped = availablePages.reduce<Record<number, Page[]>>((acc, p) => {
    (acc[p.document_id] ||= []).push(p);
    return acc;
  }, {});
  const sortedDocIds = Object.keys(grouped).map(Number).sort((a, b) => a - b);
  
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col">
        <h3 className="text-lg font-semibold mb-4">Fine-tune Model: {model.name}</h3>
        
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">New Model Name</label>
          <input
            type="text"
            value={modelName}
            onChange={e => setModelName(e.target.value)}
            className="w-full border rounded px-3 py-2"
            placeholder="e.g., MyModel_finetuned"
          />
        </div>
        
        <div className="mb-4 flex-1 overflow-y-auto">
          <label className="block text-sm font-medium mb-2">
            Select Pages for Training ({selectedPageIds.length} selected, minimum {minimumRequired})
          </label>
          <div className="border rounded p-2 max-h-64 overflow-y-auto">
            {availablePages.length === 0 ? (
              <p className="text-gray-500 text-sm">No pages with manual transcriptions available.</p>
            ) : (
              <div className="space-y-3">
                {sortedDocIds.map((docId) => {
                  const pages = grouped[docId].slice().sort((a, b) => a.page_number - b.page_number);
                  const allSelected = pages.every(p => selectedPageIds.includes(p.id));
                  const someSelected = pages.some(p => selectedPageIds.includes(p.id));
                  return (
                    <div key={docId} className="border rounded">
                      <div className="flex items-center justify-between px-2 py-1 bg-gray-50">
                        <div className="text-sm font-medium">
                          {documentNamesById[docId] || `Document ${docId}`}
                        </div>
                        <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={allSelected}
                            ref={(el) => {
                              if (el) el.indeterminate = !allSelected && someSelected;
                            }}
                            onChange={(e) => onBulkToggle(pages.map(p => p.id), e.target.checked)}
                          />
                          Select all
                        </label>
                      </div>
                      <div className="p-2 space-y-1">
                        {pages.map(page => (
                          <label key={page.id} className="flex items-center gap-2 p-1 hover:bg-gray-50 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selectedPageIds.includes(page.id)}
                              onChange={() => onPageToggle(page.id)}
                              className="rounded"
                            />
                            <span className="text-sm">
                              Page {page.page_number} ({Math.round(page.manual_transcription_percent)}% transcribed)
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-600 hover:text-gray-800"
          >
            Cancel
          </button>
          <button
            onClick={() => onStart(modelName)}
            disabled={selectedPageIds.length < minimumRequired || !modelName.trim()}
            className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            Start Fine-tuning
          </button>
        </div>
      </div>
    </div>
  );
}
