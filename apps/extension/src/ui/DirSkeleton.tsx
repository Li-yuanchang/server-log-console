/**
 * DirSkeleton —— 目录加载中的同构骨架行（2026-11-12）
 *
 * 为什么不是 spinner：
 *   旧实装是「转圈 + 正在加载目录内容」的 S12 空态模板，与本项目已定稿的
 *   「加载语言三形态」（lg- 全局 / live 徽章 / 同构骨架行列表）不一致 —— 列表类
 *   加载应当是骨架行：画出即将出现的行的形状，避免内容跳变。
 *
 * 结构：复选框 + 文件图标 + 名称条 + 大小/时间/类型三列短条，与 FileBrowserTable 行同构。
 * 底部一行小字带真实进度文案（actionStatus），信息不丢。
 */
export function DirSkeleton({
  rows = 8,
  note,
}: {
  rows?: number;
  /** 底部状态文案（通常是 actionStatus，如「正在读取 /usr/lib…」） */
  note?: string;
}) {
  return (
    <div className="dir-skel" role="status" aria-live="polite" aria-label="正在加载目录内容">
      {Array.from({ length: rows }, (_, i) => (
        <div className="dir-skel-row" key={i} aria-hidden="true">
          <span className="dir-skel-box" />
          <span className="dir-skel-ico" />
          <span className={"dir-skel-bar " + (i % 3 === 0 ? "short" : i % 3 === 1 ? "mid" : "")} />
          <span className="dir-skel-bar short" />
          <span className="dir-skel-bar short" />
          <span className="dir-skel-bar short" />
        </div>
      ))}
      <div className="dir-skel-note">
        <span className="dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        {note || "正在读取远程目录"}
      </div>
    </div>
  );
}
