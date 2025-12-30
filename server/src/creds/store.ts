
import { Credentials } from '../mail/types.js';

export interface CredentialsStore {
  get(provider: 'gmail' | 'zoho', userId: string): Promise<Credentials | undefined>;
}

export class InMemoryCredentialsStore implements CredentialsStore {
  private store = new Map<string, Credentials>();

  async get(provider: 'gmail' | 'zoho', userId: string): Promise<Credentials | undefined> {
    return this.store.get(`${provider}:${userId}`);
  }

  /**
   * Helper to seed credentials.
   * In production, this might be replaced by a management API or database seeder.
   */
  set(provider: 'gmail' | 'zoho', userId: string, creds: Credentials): void {
    this.store.set(`${provider}:${userId}`, creds);
  }
}

export const store = new InMemoryCredentialsStore();
