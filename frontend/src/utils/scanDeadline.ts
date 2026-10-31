/** Bound the whole RPC, including authentication/network stalls. Retries keep the same scan key. */
export async function withScanDeadline<T>(operation: (signal: AbortSignal) => PromiseLike<T>, timeoutMs = 10_000): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = Object.assign(new Error('Tiempo de espera agotado. El servidor no respondió a tiempo.'),
        { status: 0, detail: 'Tiempo de espera agotado' });
      reject(error);
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => operation(controller.signal)), deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
