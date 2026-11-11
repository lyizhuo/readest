import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import DailyReviewHost from '@/features/archive/review/DailyReviewHost';
import {
  loadDailyCandidates,
  loadReviewState,
  shouldShowForToday,
} from '@/features/archive/review/db';
import { selectDailyNotes } from '@/features/archive/review/select';

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: {} }) }));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: (selector: (state: unknown) => unknown) =>
    selector({ settings: { archive: { enabled: true } } }),
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/features/archive/review/db', () => ({
  DAILY_REVIEW_SHOWN_KEY: 'daily_review_shown',
  loadReviewState: vi.fn(),
  shouldShowForToday: vi.fn(),
  loadDailyCandidates: vi.fn(),
  saveReviewState: vi.fn(async () => {}),
}));
vi.mock('@/features/archive/review/select', () => ({ selectDailyNotes: vi.fn() }));

const note = {
  id: 'note-1',
  bookHash: 'book-hash',
  cfi: null,
  bookTitle: 'A Book',
  chapterTitle: 'Chapter 1',
  content: 'A note',
  createdAt: Date.now(),
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DailyReviewHost', () => {
  it('renders nothing when there are no notes to review', async () => {
    vi.mocked(loadReviewState).mockResolvedValue({ lastDay: null, shownMap: {} } as never);
    vi.mocked(shouldShowForToday).mockReturnValue(true);
    vi.mocked(loadDailyCandidates).mockResolvedValue([]);
    vi.mocked(selectDailyNotes).mockReturnValue([]);

    render(<DailyReviewHost />);
    await waitFor(() => expect(loadDailyCandidates).toHaveBeenCalled());

    // An empty modal would sit on top of the library and swallow every tap.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the review once there are notes', async () => {
    vi.mocked(loadReviewState).mockResolvedValue({ lastDay: null, shownMap: {} } as never);
    vi.mocked(shouldShowForToday).mockReturnValue(true);
    vi.mocked(loadDailyCandidates).mockResolvedValue([note]);
    vi.mocked(selectDailyNotes).mockReturnValue([note]);

    render(<DailyReviewHost />);

    await waitFor(() => expect(screen.getByText('Daily Review')).toBeTruthy());
    expect(screen.getByText('A note')).toBeTruthy();
  });
});
