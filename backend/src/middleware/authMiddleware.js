import { verifyToken, sanitizeUser } from '../services/authService.js';
import { store } from '../db/store.js';

export function authMiddleware(req, res, next) {
  const authHeader = (req.get ? req.get('Authorization') : null) || req.headers?.authorization || req.headers?.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required. Missing Bearer token.' });
  }

  const token = authHeader.substring(7).trim();
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }

  const user = store.getUserById(payload.userId);
  if (!user || !user.is_active) {
    return res.status(401).json({ error: 'User account not found or inactive.' });
  }

  const org = store.getOrgById(user.org_id);
  if (!org) {
    return res.status(401).json({ error: 'Organization associated with user not found.' });
  }

  req.user = sanitizeUser(user);
  req.rawUser = user;
  req.org = org;
  next();
}
