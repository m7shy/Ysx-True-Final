import { Router } from 'express';

const router = Router();

/**
 * Minimal stub so the server builds/runs.
 * If your frontend depends on Gemini, you can replace this later with a real implementation.
 */
router.post('/', (_req, res) => {
  res.status(501).json({
    ok: false,
    error: 'Gemini endpoint is not configured in this build.',
  });
});

export default router;
