# 拆分清单审查归档 2026-04-20

方向正确，但属愿景清单而非工程设计稿。

## 需修正

1. CSS拆分风险应为中风险（import顺序即逻辑）
2. Workspace拆分缺状态快照契约前置
3. Gateway第4节应改为index.ts路由/WS/bootstrap下沉
4. 删.electron-sidebar-drag/inline-style>CSS-class/this闭包等不准表述

## 现状数字已偏移

- App.tsx 6025行(文档写5929)
- styles.css 5498行(文档写5446)
- theme-modern.css 2830行(文档写2829)

## Hook边界

useLocalService不应塞isBusy/actionStatus/activityLines，应拆useAsyncStatus

## Gateway路由粒度

logs.ts会过大，应拆为search.ts/files.ts/recordings.ts/live.ts
