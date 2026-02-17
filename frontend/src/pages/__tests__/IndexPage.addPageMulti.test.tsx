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
  addPageToDocument: vi.fn(async () => ({})),
}));

describe('IndexPage add page', () => {
  it('supports adding multiple pages at once', async () => {
    const user = userEvent.setup();

    const createElSpy = vi.spyOn(document, 'createElement');

    render(
      <MemoryRouter initialEntries={['/document/1']}>
        <Routes>
          <Route path="/document/:documentId" element={<IndexPage />} />
        </Routes>
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: /Add Page/i }));

    const input = createElSpy.mock.results.find(r => (r.value as any)?.tagName === 'INPUT')?.value as HTMLInputElement | undefined;
    expect(input).toBeTruthy();
    expect(input?.multiple).toBe(true);

    const file1 = new File(['a'], 'a.png', { type: 'image/png' });
    const file2 = new File(['b'], 'b.png', { type: 'image/png' });

    const fakeFileList: any = {
      0: file1,
      1: file2,
      length: 2,
      item: (i: number) => [file1, file2][i] ?? null,
      *[Symbol.iterator]() {
        yield file1;
        yield file2;
      },
    };
    Object.defineProperty(input!, 'files', { value: fakeFileList });
    input!.onchange?.({ target: input } as any);

    // Confirm the batch upload in the modal once it appears
    const confirmButton = await screen.findByRole('button', {
      name: /Confirm & start upload/i,
    });
    await user.click(confirmButton);

    await waitFor(() => expect(api.addPageToDocument).toHaveBeenCalledTimes(2));
  });
});

