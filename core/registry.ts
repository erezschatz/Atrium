import type { Chamber } from './types.ts';

export function createRegistry(chambers: Chamber[]) {
  const map = new Map<string, Chamber>(
    chambers.map((c) => [c.domain, c])
  );

  return {
    list(): Chamber[] {
      return [...map.values()];
    },

    dispatch(req: Request): Response | Promise<Response> {
      const { hostname } = new URL(req.url);
      const chamber = map.get(hostname);

      if (!chamber) {
        return new Response(`No chamber registered for: "${hostname}"`, {
          status: 404,
          headers: { 'Content-Type': 'text/plain' },
        });
      }

      return chamber.fetch(req);
    },
  };
}
