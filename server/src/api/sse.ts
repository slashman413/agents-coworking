import type { Request, Response } from 'express';
import type { EventBus } from '../core/events.js';

export function createSSEHandler(eventBus: EventBus) {
  return (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const onEvent = (event: any) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    eventBus.on('*', onEvent);
    
    res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);

    const keepalive = setInterval(() => {
      res.write(`data: ${JSON.stringify({ type: 'ping', timestamp: new Date().toISOString() })}\n\n`);
    }, 30000);

    req.on('close', () => {
      clearInterval(keepalive);
      eventBus.off('*', onEvent);
    });
  };
}
