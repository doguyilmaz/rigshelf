export type BackupFetch = typeof fetch;
export const BACKUP_REQUEST_TIMEOUT_MS = 60000;
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
  const reader = response.body?.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  if (reader)
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > limit) {
          await reader.cancel();
          throw new BackupRemoteError(
            'Backup service response exceeds its size limit.',
            response.status,
          );
        }
        parts.push(part.value);
      }
    } catch (failure) {
      if (failure instanceof BackupRemoteError) throw failure;
      throw new BackupRemoteError(
        'The backup service response was interrupted. Reconcile the operation before retrying.',
        response.status,
        !['GET', 'HEAD'].includes(init.method || 'GET'),
      );
    }
  return { status: response.status, headers: response.headers, bytes: Buffer.concat(parts) };
}
