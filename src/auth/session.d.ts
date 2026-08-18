import 'express-session';

declare module 'express-session' {
  interface SessionData {
    user?: { sub: string; name: string; email?: string };
    oidc?: { state: string; nonce: string; codeVerifier: string };
  }
}
