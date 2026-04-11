import type { ImportStrategy, ImportToolMeta } from "./import-strategy.js";

export class ImportStrategyResolver {
  private readonly strategies = new Map<string, ImportStrategy>();

  register(strategy: ImportStrategy): void {
    this.strategies.set(strategy.meta.id, strategy);
  }

  resolve(toolId: string): ImportStrategy {
    const strategy = this.strategies.get(toolId);
    if (!strategy) {
      throw new Error(`不支持的导入工具：${toolId}，可用工具：${[...this.strategies.keys()].join(", ")}`);
    }
    return strategy;
  }

  listTools(): ImportToolMeta[] {
    return [...this.strategies.values()].map((s) => s.meta);
  }
}
