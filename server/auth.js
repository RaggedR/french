import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

// Initialize Firebase Admin SDK
// On Cloud Run: uses Application Default Credentials automatically
// Locally: uses ADC from `gcloud auth application-default login`
initializeApp({
  credential: applicationDefault(),
});

export const adminAuth = getAuth();

/**
 * Express middleware that verifies Firebase ID tokens.
 * Reads token from Authorization: Bearer <token> header,
 * or falls back to ?token= query param (needed for SSE/EventSource).
 * Sets req.uid and req.userEmail on success.
 */
export async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  let token = null;

  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const decoded = await adminAuth.verifyIdToken(token);
    req.uid = decoded.uid;
    req.userEmail = decoded.email || null;
    next();
  } catch (err) {
    console.error('[Auth] Token verification failed:', err.message);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
