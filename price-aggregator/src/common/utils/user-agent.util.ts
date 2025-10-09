import UserAgent = require('user-agents');

export function getRandomUserAgent(): string {
  const userAgent = new UserAgent();
  return `${userAgent.toString()} ${Date.now()}`;
}
