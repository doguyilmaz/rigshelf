import { readBounded } from './bounded-read';

export type BackupFetch = typeof fetch;
const BACKUP_REQUEST_TIMEOUT_MS = 60000;
export class BackupRemoteError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly uncertain = false,
  ) {
    super(message);
    this.name = 'BackupRemoteError';
  }
}
export async function backupResponse(
  url: string,
  init: RequestInit,
  limit: number,
  signal?: AbortSignal,
  fetcher: BackupFetch = fetch,
): Promise<{ status: number; headers: Headers; bytes: Uint8Array }> {
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.any([
        AbortSignal.timeout(BACKUP_REQUEST_TIMEOUT_MS),
        ...(signal ? [signal] : []),
      ]),
    });
  } catch {
    if (signal?.aborted)
      throw new BackupRemoteError(
        'Backup operation stopped. Check its remote status before retrying.',
        undefined,
        !['GET', 'HEAD'].includes(init.method || 'GET'),
      );
    throw new BackupRemoteError(
      'The backup service did not confirm this request. Check the connection or reconcile its status.',
      undefined,
      !['GET', 'HEAD'].includes(init.method || 'GET'),
    );
  }
  if (Number(response.headers.get('content-length') || 0) > limit) {
    await response.body?.cancel();
    throw new BackupRemoteError('Backup service response exceeds its size limit.', response.status);
  }
  if (!response.body)
    return { status: response.status, headers: response.headers, bytes: Buffer.alloc(0) };
  try {
    const bytes = await readBounded(
      response.body,
      limit,
      () =>
        new BackupRemoteError('Backup service response exceeds its size limit.', response.status),
    );
    return { status: response.status, headers: response.headers, bytes };
  } catch (failure) {
    if (failure instanceof BackupRemoteError) throw failure;
    throw new BackupRemoteError(
      'The backup service response was interrupted. Reconcile the operation before retrying.',
      response.status,
      !['GET', 'HEAD'].includes(init.method || 'GET'),
    );
  }
}
