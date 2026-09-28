import express, { type NextFunction, type Request, type Response, Router } from 'express';
import path from 'node:path';
import type { QaController } from '../../api/QaController.js';

/** Serves the UI and the vendored front-end libraries (no CDN needed). */
export function webRoutes(rootDir: string): Router {
  const router = Router();
  const nm = (p: string): string => path.join(rootDir, 'node_modules', p);
  const staticOpts = { fallthrough: false, index: false, maxAge: '1h' } as const;
  router.use('/vendor/bootstrap', express.static(nm('bootstrap/dist'), staticOpts));
  router.use('/vendor/jquery', express.static(nm('jquery/dist'), staticOpts));
  router.use('/vendor/select2', express.static(nm('select2/dist'), staticOpts));
  router.use('/vendor/select2-bootstrap-5-theme', express.static(nm('select2-bootstrap-5-theme/dist'), staticOpts));
  router.use(express.static(path.join(rootDir, 'src', 'web', 'public'), { index: 'index.html' }));
  return router;
}

export function apiRoutes(controller: QaController): Router {
  const router = Router();
  router.use(express.json({ limit: '200kb' }));
  router.get('/settings', controller.settings);
  router.post('/catalog', controller.loadCatalog);
  router.post('/session-test', controller.testSession);
  router.post('/runs', controller.startRun);
  router.post('/runs/stop', controller.stopRun);
  router.get('/runs/current', controller.currentRun);
  router.get('/report', controller.downloadReport);
  router.get('/evidence/:kind/:file', controller.evidence);
  router.get('/events', controller.events);
  return router;
}

/**
 * Local-only guard: rejects requests whose Host header is not the local address (DNS-rebinding protection)
 * and cross-site POSTs.
 */
export function localOnly(allowedHosts: string[]) {
  const allowed = new Set(allowedHosts.map((h) => h.toLowerCase()));
  return (req: Request, res: Response, next: NextFunction): void => {
    const host = (req.headers.host ?? '').toLowerCase();
    if (!allowed.has(host)) {
      res.status(403).send('Forbidden host');
      return;
    }
    const origin = req.headers.origin;
    if (req.method !== 'GET' && origin && !allowed.has(origin.replace(/^https?:\/\//, '').toLowerCase())) {
      res.status(403).send('Forbidden origin');
      return;
    }
    next();
  };
}
