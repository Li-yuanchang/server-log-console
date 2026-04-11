import type { ConnectionStrategy } from "./connection-strategy.js";
import { DirectStrategy } from "./direct-strategy.js";
import { BastionSftpStrategy } from "./bastion-sftp-strategy.js";
import type { SshExecutorService } from "../ssh-executor.service.js";
import type { ServerRegistryService } from "../../servers/server-registry.service.js";

/**
 * 策略解析器 —— 根据服务器配置自动选择直连或堡垒机 SFTP 策略。
 */
export class StrategyResolver {
  constructor(
    private readonly serverRegistry: ServerRegistryService,
    private readonly sshExecutor: SshExecutorService
  ) {}

  resolve(serverId: string): ConnectionStrategy {
    const server = this.serverRegistry.getServer(serverId);

    if (this.sshExecutor.isJumpServerBastion(server)) {
      return new BastionSftpStrategy(serverId, this.sshExecutor);
    }

    return new DirectStrategy(serverId, this.sshExecutor);
  }
}
