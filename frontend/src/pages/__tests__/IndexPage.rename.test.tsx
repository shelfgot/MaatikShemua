import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  updateDocument: vi.fn(async () => ({ id: 1, name: 'Doc Renamed', page_count: 0 })),
}));

describe('IndexPage document rename', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows inline rename of document title', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/document/1']}>
        <Routes>
          <Route path="/document/:documentId" element={<IndexPage />} />
        </Routes>
      </MemoryRouter>
    );

    const title = await screen.findByRole('heading', { name: 'Doc One' });
    await user.click(title);

    const input = screen.getByRole('textbox', { name: /document name/i });
    expect(input).toHaveValue('Doc One');

    await user.clear(input);
    await user.type(input, 'Doc Renamed{enter}');

    expect(api.updateDocument).toHaveBeenCalledWith(1, { name: 'Doc Renamed' });
  });
});

