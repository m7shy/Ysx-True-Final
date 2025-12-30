
import { vi } from 'vitest';

export const sendMail = vi.fn().mockResolvedValue('mock-message-id');
