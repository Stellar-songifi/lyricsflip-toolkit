import * as SecureStore from 'expo-secure-store';
import type { SecretStore } from './wallet';

export const secureStore: SecretStore = {
  get: (key) => SecureStore.getItemAsync(key),
  set: (key, value) => SecureStore.setItemAsync(key, value),
};
