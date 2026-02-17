import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
      currentDocument: { id: 1, name: 'Doc One', page_count: 0 },
      pages: [],
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
  deleteDocument: vi.fn(async () => {}),
}));

describe('IndexPage delete document', () => {
  it('asks for confirmation before deleting a document', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(
      <MemoryRouter initialEntries={['/document/1']}>
        <Routes>
          <Route path="/document/:documentId" element={<IndexPage />} />
        </Routes>
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: /Document options/i }));
    await user.click(screen.getByRole('button', { name: /Delete Document/i }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(api.deleteDocument).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });
});

