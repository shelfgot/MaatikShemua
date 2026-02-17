import { useCallback, useEffect, useRef, useState } from 'react';
import { debounce } from 'lodash';
import { TranscriptionLine } from '../types';

interface UseAutoSaveOptions {
  pageId: number;
  onSave: (lines: TranscriptionLine[]) => Promise<void>;
  debounceMs?: number;
}

export function useAutoSave({ pageId, onSave, debounceMs = 3000 }: UseAutoSaveOptions) {
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const backupKey = `maatik_backup_${pageId}`;
  
  // Save to localStorage immediately
  const saveToLocalStorage = useCallback((lines: TranscriptionLine[]) => {
    localStorage.setItem(backupKey, JSON.stringify({
      lines,
      timestamp: new Date().toISOString()
    }));
    setHasUnsavedChanges(true);
  }, [backupKey]);
  
  // Save to server
  const saveToServer = useCallback(async (lines: TranscriptionLine[]) => {
    setIsSaving(true);
    setError(null);
    try {
      await onSave(lines);
      localStorage.removeItem(backupKey);
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
      console.error('Save failed:', err);
    } finally {
      setIsSaving(false);
    }
  }, [onSave, backupKey, pageId]);
  
  // Keep a ref to the current saveToServer to avoid stale closure in debounced function
  const saveToServerRef = useRef(saveToServer);
  useEffect(() => {
    saveToServerRef.current = saveToServer;
  }, [saveToServer]);
  
  // Debounced server save - uses ref to always call latest saveToServer
  const debouncedSave = useRef(
    debounce((lines: TranscriptionLine[]) => saveToServerRef.current(lines), debounceMs)
  ).current;
  
  // Combined save
  const save = useCallback((lines: TranscriptionLine[]) => {
    saveToLocalStorage(lines);
    debouncedSave(lines);
  }, [saveToLocalStorage, debouncedSave]);
  
  // Force immediate save
  const forceSave = useCallback(async (lines: TranscriptionLine[]) => {
    debouncedSave.cancel();
    await saveToServer(lines);
  }, [debouncedSave, saveToServer]);
  
  // Check for backup on mount
  const getBackup = useCallback(() => {
    const backup = localStorage.getItem(backupKey);
    if (backup) {
      try {
        return JSON.parse(backup);
      } catch {
        return null;
      }
    }
    return null;
  }, [backupKey]);
  
  // Clear backup
  const clearBackup = useCallback(() => {
    localStorage.removeItem(backupKey);
  }, [backupKey]);
  
  // Warn before leaving with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      debouncedSave.cancel();
    };
  }, [debouncedSave]);
  
  return {
    save,
    forceSave,
    lastSaved,
    isSaving,
    hasUnsavedChanges,
    error,
    getBackup,
    clearBackup,
  };
}
