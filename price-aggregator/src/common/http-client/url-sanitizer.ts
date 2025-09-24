const SECRET_PARAM_KEYS = [
  'api_key',
  'apikey',
  'apiKey',
  'token',
  'access_token',
  'key',
  'secret',
  'signature',
  'sig',
];

export function sanitizeUrlForLogging(url: string): string {
  try {
    const urlObj = new URL(url);
    SECRET_PARAM_KEYS.forEach((key) => {
      if (urlObj.searchParams.has(key)) {
        urlObj.searchParams.set(key, 'REDACTED');
      }
    });
    return `${urlObj.origin}${urlObj.pathname}${
      urlObj.searchParams.size ? `?${urlObj.searchParams.toString()}` : ''
    }`;
  } catch {
    return '[invalid-url]';
  }
}
