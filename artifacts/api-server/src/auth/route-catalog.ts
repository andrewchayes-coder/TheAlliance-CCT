import type { IRouter } from 'express';
const mountPrefixes = new WeakMap<object, string>();
export function mountApiRouter(parent: IRouter, prefix: string, child: IRouter) {
  parent.use(prefix || '/', child);
  mountPrefixes.set(parent.stack.at(-1)!, prefix);
}
/** Express 5 does not expose Express 4's layer.regexp. Track mounts, inspect real routes. */
export function apiRouteCatalog(router: IRouter) {
  const routes: Array<{ method: string; path: string }> = [];
  function walk(stack: Array<any>, prefix: string) {
    for (const layer of stack) {
      if (layer.route) {
        const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
        for (const path of paths) {
          if (typeof path !== 'string') throw new Error('API paths must be inspectable strings.');
          for (const method of Object.keys(layer.route.methods)) {
            if (method === '_all') throw new Error(`Declare explicit API methods: ${prefix}${path}`);
            routes.push({ method: method.toUpperCase(), path: `${prefix}${path}` });
          }
        }
      } else if (layer.handle?.stack) {
        if (!mountPrefixes.has(layer)) throw new Error('Use mountApiRouter() for API subrouters so guards can be audited.');
        walk(layer.handle.stack, prefix + mountPrefixes.get(layer));
      }
    }
  }
  walk(router.stack, '');
  return routes;
}
