
import { vi } from 'vitest';

export const fetchSent = vi.fn().mockResolvedValue([
  { uid: 1, subject: 'Test 1', from: 'me', to: ['u1'], date: new Date().toISOString(), snippet: 's1' },
  { uid: 2, subject: 'Test 2', from: 'me', to: ['u2'], date: new Date().toISOString(), snippet: 's2' },
  { uid: 3, subject: 'Test 3', from: 'me', to: ['u3'], date: new Date().toISOString(), snippet: 's3' }
]);
