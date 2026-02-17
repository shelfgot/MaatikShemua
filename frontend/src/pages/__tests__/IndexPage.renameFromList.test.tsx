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
      documents: [{ id: 5, name: 'Doc Five', page_count: 1, shelfmark: null }],
      currentDocument: null,
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
  updateDocument: vi.fn(async () => ({ id: 5, name: 'Doc Five Renamed', page_count: 1 })),
}));

describe('IndexPage rename from documents list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renames via pencil icon on the documents grid', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<IndexPage />} />
        </Routes>
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: /Rename Doc Five/i }));

    const input = screen.getByRole('textbox', { name: /Rename document 5/i });
    await user.clear(input);
    await user.type(input, 'Doc Five Renamed{enter}');

    expect(api.updateDocument).toHaveBeenCalledWith(5, { name: 'Doc Five Renamed' });
  });
});

