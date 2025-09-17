import {
  SourceAdapter,
  WithBatch,
  WithWebSocket,
} from './source-adapter.interface';

export function isSourceAdapterWithBatch(
  adapter: SourceAdapter,
): adapter is SourceAdapter & WithBatch {
  return 'fetchQuotes' in adapter && typeof adapter.fetchQuotes === 'function';
}

export function isSourceAdapterWithWebSocket(
  adapter: SourceAdapter,
): adapter is SourceAdapter & WithWebSocket {
  return (
    'streamQuotes' in adapter && typeof adapter.streamQuotes === 'function'
  );
}
