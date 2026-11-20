/**
 * 時間制限つきの fetch（ブラウザ・サーバーの両方で使える）。
 * 電波の弱い場所では通信が止まったまま応答が返らないことがあるため、一定時間で打ち切り、
 * 「再試行」を出せるようにする。呼び出し側の signal による中断もそのまま伝える。
 *
 * 時間切れのときは name が "TimeoutError" のエラーを投げる（呼び出し側の中断は "AbortError"）。
 */
export async function fetchWithTimeout(
  input: string,
  init: RequestInit & { timeoutMs: number },
): Promise<Response> {
  const { timeoutMs, signal, ...rest } = init;
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  const forward = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener("abort", forward, { once: true });
  }
  try {
    return await fetch(input, { ...rest, signal: ctrl.signal });
  } catch (e) {
    if (timedOut) {
      const err = new Error("request timed out");
      err.name = "TimeoutError";
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forward);
  }
}
