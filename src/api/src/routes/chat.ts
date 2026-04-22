import { type Express, type Request, type Response } from 'express';

export function mapChatEndpoints(app: Express): void {
  // Legacy placeholder — real chat is at /api/podcasts/sessions/:id/chat
  app.post('/api/chat/sessions', (_req: Request, res: Response) => {
    res.status(410).json({ error: 'Use /api/podcasts/sessions/:sessionId/chat instead' });
  });

  app.get('/api/chat/sessions/:sessionId', (_req: Request, res: Response) => {
    res.status(410).json({ error: 'Use /api/podcasts/sessions/:sessionId/chat instead' });
  });

  app.post('/api/chat/sessions/:sessionId/messages', (_req: Request, res: Response) => {
    res.status(410).json({ error: 'Use /api/podcasts/sessions/:sessionId/chat instead' });
  });
}
