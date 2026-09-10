import { api } from './api';

export interface AuthUser {
  id: string;
  username: string;
  walletAddress: string | null;
  xp: number;
  level: string;
}

interface ChallengeResponse {
  transactionXdr: string;
  networkPassphrase: string;
}

interface VerifyResponse {
  accessToken: string;
  user: AuthUser;
}

export const authApi = {
  getChallenge: (walletAddress: string) =>
    api.post<ChallengeResponse>('/auth/stellar/challenge', { walletAddress }),
  verify: (walletAddress: string, signedTransactionXdr: string) =>
    api.post<VerifyResponse>('/auth/stellar/verify', { walletAddress, signedTransactionXdr }),
};
