// Must be imported before anything that loads @stellar/stellar-sdk.
// See packages/sdk/README.md#react-native for why each one is needed.
import 'react-native-get-random-values';
import 'react-native-url-polyfill/auto';

if (typeof globalThis.TextDecoder === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('fast-text-encoding');
}
