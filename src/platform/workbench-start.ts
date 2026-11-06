import type { Store } from '../core/store';
import { startServer, type WorkbenchServer } from '../server';

const DEFAULT_PORT = 47471;
const MAX_PORT_ATTEMPTS = 8;

/** Only the implicit default may move. Never stop or assume ownership of an occupied port. */
export function openWorkbenchServer(
  store: Store,
  requestedPort?: number,
  resetAccess = false,
): {
  server: WorkbenchServer;
  moved: boolean;
} {
  const first = requestedPort ?? DEFAULT_PORT;
  const attempts = requestedPort === undefined && !resetAccess ? MAX_PORT_ATTEMPTS : 1;
  for (let offset = 0; offset < attempts; offset++) {
    try {
      return { server: startServer(store, first + offset, { resetAccess }), moved: offset > 0 };
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EADDRINUSE')
        throw error;
      if (offset + 1 === attempts)
        throw new Error(
          `Port ${first + offset} is in use. Try rigshelf ui --port ${Math.min(first + offset + 1, 65535)}. No existing process was stopped.`,
        );
    }
  }
  throw new Error('Could not start the local workbench.');
}
