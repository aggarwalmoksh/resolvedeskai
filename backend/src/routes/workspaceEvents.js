import express from 'express';
import { store } from '../db/store.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', authMiddleware, async (req, res, next) => {
  let closed = false;
  let timer;
  const close = () => {
    closed = true;
    clearTimeout(timer);
  };
  res.on('close', close);
  try {
    let revision = await store.getWorkspaceRevision(req.org.id);
    if (closed) return;
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write('data: ready\n\n');

    const expiresAt = Date.now() + 25000;
    const poll = async () => {
      try {
        if (closed) return;
        if (Date.now() >= expiresAt) return res.end();
        const current = await store.getWorkspaceRevision(req.org.id);
        if (closed) return;
        if (current !== revision) {
          revision = current;
          res.write('data: changed\n\n');
        }
        timer = setTimeout(poll, 1500);
      } catch {
        res.end();
      }
    };
    timer = setTimeout(poll, 1500);
  } catch (error) {
    if (!closed) next(error);
  }
});

export default router;
