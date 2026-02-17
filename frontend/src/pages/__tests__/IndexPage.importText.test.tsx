import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import IndexPage from '../IndexPage';
import * as api from '../../services/api';

const storeMocks = {
  fetchDocuments: vi.fn(async () => {}),
  fetchDocument: vi.fn(async () => {}),
  fetchPages: vi.fn(async () => {}),
  setCurrentDocument: vi.fn(),
};

vi.mock('../../store/documentStore', () => {
  return {
    useDocumentStore: () => ({
      documents: [],
      currentDocument: { id: 1, name: 'Doc One', page_count: 2 },
      pages: [
        { id: 11, document_id: 1, page_number: 1, image_path: 'x', lines_detected: false, is_ground_truth: false, line_order_mode: 'rtl', manual_transcription_percent: 0, has_model_transcription: false },
        { id: 12, document_id: 1, page_number: 2, image_path: 'y', lines_detected: false, is_ground_truth: false, line_order_mode: 'rtl', manual_transcription_percent: 0, has_model_transcription: false },
      ],
      documentsLoading: false,
      pagesLoading: false,
      fetchDocuments: storeMocks.fetchDocuments,
      fetchDocument: storeMocks.fetchDocument,
      fetchPages: storeMocks.fetchPages,
      setCurrentDocument: storeMocks.setCurrentDocument,
    }),
  };
});

vi.mock('../../services/api', () => ({
  getModels: vi.fn(async () => ({ items: [] })),
  importTextFile: vi.fn(async () => ({ imported_pages: [2], warnings: [] })),
}));

describe('IndexPage text import', () => {
  it('wraps single-page text with selected Page N marker before upload', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/document/1']}>
        <Routes>
          <Route path="/document/:documentId" element={<IndexPage />} />
        </Routes>
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: /More actions/i }));
    await user.click(screen.getByRole('button', { name: /Import Text/i }));

    const file = new File(['line1\nline2'], 't.txt', { type: 'text/plain' });
    const fileInput = screen.getByLabelText(/transcription txt/i) as HTMLInputElement;
    await user.upload(fileInput, file);

    await user.selectOptions(screen.getByLabelText(/target page/i), '2');
    await user.click(screen.getByRole('button', { name: /^Import$/i }));

    await waitFor(() => expect(api.importTextFile).toHaveBeenCalled());
    const call = (api.importTextFile as any).mock.calls[0];
    const sentText: string = call[1];
    expect(sentText.startsWith('Page 2\n')).toBe(true);
  });
});

