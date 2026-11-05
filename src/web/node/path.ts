// Stands in for node:path in the browser build (see vite.config.ts). Paths here are
// the virtual ones from web/node/fs.ts, always "/"-separated.

export function basename(path: string) {
  return path.slice(path.lastIndexOf('/') + 1);
}

// `...parts` collects every argument into an array. The regex /\/+/g
// collapses runs of slashes, so join('/a/', 'b') gives '/a/b'.
export function join(...parts: string[]) {
  return parts.join('/').replace(/\/+/g, '/');
}
