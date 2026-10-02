/**
 * 上传暂停 / 继续 / 取消的流程控制闸门。
 *
 * 背景：上传分三条路径，可打断粒度不同——
 *   ① 分片上传（≥10MB）：客户端逐片 POST，可在每个分片前设检查点 → 真·暂停；
 *   ② 小文件（<10MB）：单个 POST 请求，无中间态 → 暂停在「文件边界」生效；
 *   ③ Electron 本地直传：服务端一条流式拷贝，客户端只收进度 → 同样在文件边界生效。
 * 因此统一用「检查点」模型：循环在安全点 await，暂停时挂起、继续时放行、取消时抛错。
 */

export type TransferPhase = "idle" | "uploading" | "paused";

/** 取消上传时抛出，供上层区分「用户取消」与「真实失败」（不记为失败记录） */
export class TransferCancelledError extends Error {
  constructor() {
    super("上传已取消");
    this.name = "TransferCancelledError";
  }
}

export class TransferGate {
  private paused = false;
  private cancelled = false;
  private waiters: Array<() => void> = [];

  get isPaused(): boolean {
    return this.paused;
  }

  get isCancelled(): boolean {
    return this.cancelled;
  }

  pause(): void {
    if (this.cancelled) return;
    this.paused = true;
  }

  resume(): void {
    if (this.cancelled) return;
    this.paused = false;
    this.releaseWaiters();
  }

  cancel(): void {
    this.cancelled = true;
    this.paused = false;
    this.releaseWaiters();
  }

  private releaseWaiters(): void {
    const pending = this.waiters;
    this.waiters = [];
    pending.forEach((fn) => fn());
  }

  /**
   * 安全检查点：取消立即抛错；暂停则挂起，直到 resume / cancel。
   * 调用方应在「可安全中断的位置」调用（分片之间、文件之间）。
   */
  async checkpoint(): Promise<void> {
    if (this.cancelled) throw new TransferCancelledError();
    if (!this.paused) return;
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    if (this.cancelled) throw new TransferCancelledError();
  }
}
