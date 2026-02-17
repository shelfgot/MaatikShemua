import { create } from 'zustand';
import { Document, Page, Transcription, TranscriptionLine } from '../types';
import * as api from '../services/api';

interface DocumentState {
  // Documents
  documents: Document[];
  currentDocument: Document | null;
  documentsLoading: boolean;
  
  // Pages
  pages: Page[];
  currentPage: Page | null;
  pagesLoading: boolean;
  
  // Transcription
  manualTranscription: Transcription | null;
  modelTranscription: Transcription | null;
  transcriptionLoading: boolean;
  
  // Lines
  lineData: { lines: any[]; display_order: number[] } | null;
  
  // Actions
  fetchDocuments: () => Promise<void>;
  fetchDocument: (id: number) => Promise<void>;
  fetchPages: (documentId: number) => Promise<void>;
  fetchPage: (pageId: number) => Promise<void>;
  fetchTranscription: (pageId: number, type: 'manual' | 'model') => Promise<void>;
  fetchLineData: (pageId: number) => Promise<void>;
  updateTranscription: (pageId: number, lines: TranscriptionLine[]) => Promise<void>;
  
  // Setters
  setCurrentDocument: (doc: Document | null) => void;
  setCurrentPage: (page: Page | null) => void;
}

export const useDocumentStore = create<DocumentState>((set) => ({
  documents: [],
  currentDocument: null,
  documentsLoading: false,
  
  pages: [],
  currentPage: null,
  pagesLoading: false,
  
  manualTranscription: null,
  modelTranscription: null,
  transcriptionLoading: false,
  
  lineData: null,
  
  fetchDocuments: async () => {
    set({ documentsLoading: true });
    try {
      const response = await api.getDocuments();
      set({ documents: response.items, documentsLoading: false });
    } catch (error) {
      console.error('Failed to fetch documents:', error);
      set({ documentsLoading: false });
    }
  },
  
  fetchDocument: async (id: number) => {
    try {
      const document = await api.getDocument(id);
      set({ currentDocument: document });
    } catch (error) {
      console.error('Failed to fetch document:', error);
    }
  },
  
  fetchPages: async (documentId: number) => {
    set({ pagesLoading: true });
    try {
      const response = await api.getDocumentPages(documentId);
      set({ pages: response.items, pagesLoading: false });
    } catch (error) {
      console.error('Failed to fetch pages:', error);
      set({ pagesLoading: false });
    }
  },
  
  fetchPage: async (pageId: number) => {
    try {
      const page = await api.getPage(pageId);
      set({ currentPage: page });
    } catch (error) {
      console.error('Failed to fetch page:', error);
    }
  },
  
  fetchTranscription: async (pageId: number, type: 'manual' | 'model') => {
    set({ transcriptionLoading: true });
    try {
      const transcription = await api.getTranscription(pageId, type);
      if (type === 'manual') {
        set({ manualTranscription: transcription, transcriptionLoading: false });
      } else {
        set({ modelTranscription: transcription, transcriptionLoading: false });
      }
    } catch (error) {
      console.error('Failed to fetch transcription:', error);
      set({ transcriptionLoading: false });
    }
  },
  
  fetchLineData: async (pageId: number) => {
    try {
      const lineData = await api.getPageLines(pageId);
      set({ lineData });
    } catch (error) {
      console.error('Failed to fetch line data:', error);
    }
  },
  
  updateTranscription: async (pageId: number, lines: TranscriptionLine[]) => {
    try {
      const transcription = await api.updateTranscription(pageId, lines);
      set({ manualTranscription: transcription });
    } catch (error) {
      console.error('Failed to update transcription:', error);
      throw error;
    }
  },
  
  setCurrentDocument: (doc) => set({ currentDocument: doc }),
  setCurrentPage: (page) => set({ currentPage: page }),
}));
