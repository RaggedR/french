import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock firebase-admin/app and firebase-admin/auth before importing auth.js
const mockVerifyIdToken = vi.fn();

vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(),
  applicationDefault: vi.fn(),
}));

vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({
    verifyIdToken: mockVerifyIdToken,
  }),
}));

// Now import the module under test (after mocks are set up)
const { requireAuth } = await import('./auth.js');

// Helper to create mock Express req/res/next
function mockReqResNext(overrides = {}) {
  const req = {
    headers: overrides.headers ?? {},
    query: overrides.query ?? {},
  };
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
  const next = vi.fn();
  return { req, res, next };
}

describe('requireAuth middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── No token ────────────────────────────────────────────

  it('returns 401 when no Authorization header and no query token', async () => {
    const { req, res, next } = mockReqResNext();

    await requireAuth(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('Authentication required');
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when Authorization header is present but not Bearer', async () => {
    const { req, res, next } = mockReqResNext({
      headers: { authorization: 'Basic abc123' },
    });

    await requireAuth(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('Authentication required');
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when Authorization header is empty string', async () => {
    const { req, res, next } = mockReqResNext({
      headers: { authorization: '' },
    });

    await requireAuth(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('Authentication required');
  });

  // ─── Bearer token (Authorization header) ─────────────────

  it('extracts token from Bearer header and verifies it', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-123', email: 'test@example.com' });
    const { req, res, next } = mockReqResNext({
      headers: { authorization: 'Bearer valid-token-abc' },
    });

    await requireAuth(req, res, next);

    expect(mockVerifyIdToken).toHaveBeenCalledWith('valid-token-abc');
    expect(req.uid).toBe('user-123');
    expect(req.userEmail).toBe('test@example.com');
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBeNull();
  });

  it('sets userEmail to null when decoded token has no email', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'anon-456' });
    const { req, res, next } = mockReqResNext({
      headers: { authorization: 'Bearer anon-token' },
    });

    await requireAuth(req, res, next);

    expect(req.uid).toBe('anon-456');
    expect(req.userEmail).toBeNull();
    expect(next).toHaveBeenCalledTimes(1);
  });

  // ─── Query param token (SSE/EventSource fallback) ────────

  it('falls back to query param token when no Authorization header', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'sse-user', email: 'sse@test.com' });
    const { req, res, next } = mockReqResNext({
      query: { token: 'query-token-xyz' },
    });

    await requireAuth(req, res, next);

    expect(mockVerifyIdToken).toHaveBeenCalledWith('query-token-xyz');
    expect(req.uid).toBe('sse-user');
    expect(req.userEmail).toBe('sse@test.com');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('prefers Bearer header over query param when both present', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'bearer-user', email: null });
    const { req, res, next } = mockReqResNext({
      headers: { authorization: 'Bearer header-token' },
      query: { token: 'query-token' },
    });

    await requireAuth(req, res, next);

    expect(mockVerifyIdToken).toHaveBeenCalledWith('header-token');
    expect(req.uid).toBe('bearer-user');
  });

  // ─── Invalid/expired tokens ──────────────────────────────

  it('returns 401 when token verification fails', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('Firebase ID token has expired'));
    const { req, res, next } = mockReqResNext({
      headers: { authorization: 'Bearer expired-token' },
    });

    await requireAuth(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('Invalid or expired token');
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when token is malformed', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('Decoding Firebase ID token failed'));
    const { req, res, next } = mockReqResNext({
      headers: { authorization: 'Bearer not.a.real.jwt' },
    });

    await requireAuth(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('Invalid or expired token');
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when token is revoked', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('Firebase ID token has been revoked'));
    const { req, res, next } = mockReqResNext({
      query: { token: 'revoked-token' },
    });

    await requireAuth(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('Invalid or expired token');
    expect(next).not.toHaveBeenCalled();
  });

  // ─── Edge cases ──────────────────────────────────────────

  it('does not set uid/userEmail on req when verification fails', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('bad token'));
    const { req, res, next } = mockReqResNext({
      headers: { authorization: 'Bearer bad' },
    });

    await requireAuth(req, res, next);

    expect(req.uid).toBeUndefined();
    expect(req.userEmail).toBeUndefined();
  });

  it('handles "Bearer " with empty token string', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('empty token'));
    const { req, res, next } = mockReqResNext({
      headers: { authorization: 'Bearer ' },
    });

    // "Bearer " → token = "" (empty string), which is falsy
    await requireAuth(req, res, next);

    // Empty string is falsy, so it hits the "no token" path
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('Authentication required');
    expect(mockVerifyIdToken).not.toHaveBeenCalled();
  });
});
