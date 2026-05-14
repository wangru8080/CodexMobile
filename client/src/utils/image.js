export function imageUrlWithRetry(url, retryKey) {
  if (!retryKey) {
    return url;
  }
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}r=${retryKey}`;
}
