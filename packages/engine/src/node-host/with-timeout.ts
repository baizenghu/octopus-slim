// Stub — node-host was removed in engine-slim.

export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  label?: string,
): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label ?? "Operation"} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    fn().then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
