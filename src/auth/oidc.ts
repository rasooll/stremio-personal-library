import type { Express, RequestHandler } from 'express';
import {
  authorizationCodeGrant, buildAuthorizationUrl, calculatePKCECodeChallenge, ClientSecretPost,
  discovery, randomNonce, randomPKCECodeVerifier, randomState, type Configuration,
} from 'openid-client';
import type { Config } from '../config.js';

export async function configureOidc(app: Express, config: Config): Promise<RequestHandler> {
  let oidc: Configuration | null = null;
  if (config.oidcConfigured) {
    oidc = await discovery(new URL(config.OIDC_ISSUER_URL), config.OIDC_CLIENT_ID, { redirect_uris: [config.OIDC_REDIRECT_URI] }, ClientSecretPost(config.OIDC_CLIENT_SECRET));
  }

  app.get('/auth/login', async (req, res, next) => {
    try {
      if (!oidc) { req.session.user = { sub: 'development', name: 'Local Administrator' }; return res.redirect('/admin'); }
      const codeVerifier = randomPKCECodeVerifier();
      const state = randomState(); const nonce = randomNonce();
      req.session.oidc = { codeVerifier, state, nonce };
      const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);
      const url = buildAuthorizationUrl(oidc, { redirect_uri: config.OIDC_REDIRECT_URI, scope: 'openid profile email', code_challenge: codeChallenge, code_challenge_method: 'S256', state, nonce });
      res.redirect(url.href);
    } catch (error) { next(error); }
  });

  app.get('/auth/callback', async (req, res, next) => {
    try {
      if (!oidc || !req.session.oidc) throw new Error('OIDC login session is missing');
      const currentUrl = new URL(req.originalUrl, config.PUBLIC_ADDON_URL);
      const tokens = await authorizationCodeGrant(oidc, currentUrl, {
        pkceCodeVerifier: req.session.oidc.codeVerifier,
        expectedState: req.session.oidc.state,
        expectedNonce: req.session.oidc.nonce,
      });
      const claims = tokens.claims();
      if (!claims?.sub) throw new Error('OIDC provider did not return a subject');
      const user = { sub: claims.sub, name: String(claims.name ?? claims.preferred_username ?? claims.sub), email: claims.email ? String(claims.email) : undefined };
      req.session.regenerate((error) => {
        if (error) return next(error);
        req.session.user = user;
        req.session.save((saveError) => saveError ? next(saveError) : res.redirect('/admin'));
      });
    } catch (error) { next(error); }
  });

  app.post('/auth/logout', (req, res, next) => req.session.destroy((error) => error ? next(error) : res.status(204).end()));

  return (req, res, next) => {
    if (req.session.user) return next();
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Authentication required' });
    return res.redirect('/auth/login');
  };
}
