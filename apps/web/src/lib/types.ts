export type AuthProvider = 'google' | 'apple' | 'demo';

export interface User {
  id: string;
  provider: AuthProvider;
  displayName: string;
  createdAt: string;
}
