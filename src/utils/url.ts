export function buildPublicUrl(publicBaseUrl: string, relativePath: string): string {
  const base = new URL(publicBaseUrl);
  if (base.protocol !== 'http:' && base.protocol !== 'https:') {
    throw new Error('Public base URL must use HTTP or HTTPS');
  }
  const basePath = base.pathname.replace(/\/+$/, '');
  const segments = relativePath.replace(/\\/g, '/').replace(/^\/+/, '').split('/');
  base.pathname = `${basePath}/${segments.map(encodeSegment).join('/')}`;
  return base.toString();
}

function encodeSegment(segment: string): string {
  try {
    return encodeURIComponent(decodeURIComponent(segment));
  } catch {
    return encodeURIComponent(segment);
  }
}
