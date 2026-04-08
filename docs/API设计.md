# API设计

基础地址：`http://localhost:4040`

本文档描述浏览器扩展与本地日志网关之间的接口约定。所有日志执行能力都由本地网关承接，前端只提交结构化参数。

## 1. 健康检查

### `GET /health`

用于确认网关服务是否正常启动。

返回示例：

```json
{
  "ok": true,
  "service": "gateway",
  "now": "2026-04-06T12:00:00.000Z"
}
```

## 2. 获取服务器清单

### `GET /api/servers`

返回当前可用服务器列表，包括内置服务器和已经导入的 FinalShell 连接。

单个服务器对象字段说明：

- `id`：服务器唯一标识
- `name`：服务器展示名称
- `host`：服务器地址
- `port`：SSH 端口
- `username`：默认用户名
- `basePath`：默认日志路径
- `profile`：日志模板类型
- `tags`：标签集合
- `source`：数据来源，例如 `builtin`、`finalshell`
- `groupPath`：FinalShell 分组路径
- `authType`：认证方式
- `hasStoredSecret`：是否存在本地已保存密钥信息

## 3. 导入 FinalShell 连接

### `GET /api/import/finalshell`

从本机读取 FinalShell 配置，将连接写入内存注册表。若分组路径包含“生产”，则只增加谨慎提示，不做自动屏蔽。

返回示例：

```json
{
  "importedAt": "2026-04-06T12:00:00.000Z",
  "resolvedPath": "/Users/name/Library/FinalShell/conn",
  "searchedPaths": [
    "/Users/name/Library/FinalShell/conn",
    "/Users/name/.finalshell/conn"
  ],
  "servers": [
    {
      "id": "finalshell:abc123",
      "name": "web-server-01",
      "host": "10.0.0.100",
      "port": 22,
      "username": "root",
      "basePath": "/var/log",
      "profile": "custom",
      "tags": ["imported", "finalshell"],
      "source": "finalshell",
      "groupPath": ["开发"],
      "authType": "password",
      "hasStoredSecret": true
    }
  ]
}
```

说明：

- `resolvedPath` 表示实际识别到的 FinalShell 配置目录
- `searchedPaths` 表示自动发现时尝试过的目录列表
- 分组路径带“生产”的连接仍会出现在 `servers` 中，但可带 `cautionLabel`

## 4. 历史日志检索

### `POST /api/logs/search`

用于执行历史日志搜索。

请求体示例：

```json
{
  "serverId": "demo-travel-116",
  "filePath": "/home/test_travel-8280/logs/catalina.out",
  "keyword": "TRAVEL_SPECIAL_SUBSIDY",
  "date": "2026-04-01",
  "contextLines": 3,
  "useRegex": false
}
```

返回体示例：

```json
{
  "commandPreview": "bash -lc '...'",
  "truncated": false,
  "matches": [
    {
      "source": "catalina.out",
      "lineNumber": 30176495,
      "preview": "Execute SQL : insert into travel_special_subsidy ..."
    }
  ],
  "rawOutput": "# Host: ...\n# Command: ...\n..."
}
```

字段说明：

- `commandPreview`：网关生成的命令预览，便于排查
- `truncated`：结果是否被截断
- `matches`：结构化命中列表
- `rawOutput`：原始文本输出

常见错误场景：

- `serverId` 不存在
- 缺少 SSH 凭据
- SSH 连接失败
- 远程命令超时

## 5. 远程目录浏览

### `POST /api/logs/files`

用于读取远程日志目录。

请求体示例：

```json
{
  "serverId": "demo-travel-116",
  "directoryPath": "/home/test_travel-8280/logs"
}
```

返回体示例：

```json
{
  "directoryPath": "/home/test_travel-8280/logs",
  "entries": [
    {
      "path": "/home/test_travel-8280/logs/catalina.out",
      "name": "catalina.out",
      "kind": "file",
      "size": 6144
    }
  ]
}
```

字段说明：

- `directoryPath`：实际读取的目录
- `entries`：目录项列表
- `kind`：`file` 或 `directory`

## 6. 大日志元信息

### `POST /api/logs/meta`

用于读取日志文件基础信息，适合在切片浏览前先摸清文件大小和更新时间。

请求体示例：

```json
{
  "serverId": "demo-travel-116",
  "filePath": "/home/test_travel-8280/logs/catalina.out"
}
```

返回体示例：

```json
{
  "filePath": "/home/test_travel-8280/logs/catalina.out",
  "size": 6442450944,
  "modifiedTime": "2026-04-06T21:30:12",
  "readable": true,
  "encodingHint": "utf-8"
}
```

字段说明：

- `size`：文件大小，单位字节
- `modifiedTime`：文件修改时间
- `readable`：是否可读
- `encodingHint`：编码推测

## 7. 大日志切片读取

### `POST /api/logs/slice`

用于按字节区间读取大日志片段，避免整文件下载。

请求体示例：

```json
{
  "serverId": "demo-travel-116",
  "filePath": "/home/test_travel-8280/logs/catalina.out",
  "offset": 0,
  "length": 65536
}
```

返回体示例：

```json
{
  "filePath": "/home/test_travel-8280/logs/catalina.out",
  "requestedOffset": 0,
  "requestedLength": 65536,
  "actualOffset": 0,
  "actualLength": 64210,
  "content": "....",
  "isStart": true,
  "isEnd": false,
  "nextOffset": 64210
}
```

字段说明：

- `requestedOffset`：前端请求的偏移量
- `requestedLength`：前端请求的长度
- `actualOffset`：服务端最终返回的实际偏移
- `actualLength`：实际返回字节数
- `content`：本次切片内容
- `isStart`：是否已到文件开头
- `isEnd`：是否已到文件尾部
- `nextOffset`：建议下一次读取的偏移位置

## 8. 历史结果导出

### `POST /api/logs/export`

请求结构与 `/api/logs/search` 相同，但响应为文本附件流，便于直接下载检索结果文件。

## 9. 实时日志预览

### `POST /api/logs/live`

用于生成实时日志会话预览信息，便于前端展示。

请求体示例：

```json
{
  "serverId": "demo-travel-116",
  "filePath": "/home/test_travel-8280/logs/catalina.out",
  "keyword": "ERROR"
}
```

返回体示例：

```json
{
  "sessionId": "demo-travel-116-1775480000000",
  "commandPreview": "bash -lc 'tail -F ...'"
}
```

## 10. 实时日志 WebSocket

### `WS /ws/live`

用于建立实时日志流。

客户端启动消息：

```json
{
  "action": "start",
  "serverId": "demo-travel-116",
  "filePath": "/home/test_travel-8280/logs/catalina.out",
  "keyword": "ERROR"
}
```

服务端正常输出消息：

```json
{
  "sessionId": "live-demo-travel-116-1775480000000",
  "chunk": "2026-04-06 15:00:00 ERROR ...",
  "timestamp": "2026-04-06T12:00:00.000Z"
}
```

服务端 stderr 消息：

```json
{
  "type": "stderr",
  "sessionId": "live-demo-travel-116-1775480000000",
  "chunk": "grep: file not found",
  "timestamp": "2026-04-06T12:00:01.000Z"
}
```

服务端错误消息：

```json
{
  "type": "error",
  "message": "No SSH credential configured for Travel Demo 116."
}
```

关闭消息：

```json
{
  "type": "closed",
  "sessionId": "live-demo-travel-116-1775480000000"
}
```

## 11. 设计原则

当前 API 设计坚持以下原则：

- 前端提交结构化参数，不直接传 shell 命令
- 所有 SSH 与日志执行动作统一由网关接管
- 支持历史检索、实时追踪、目录浏览和大文件切片四类核心场景
- 保持接口简单，优先满足日志快速定位需求

后续如果要扩展日志模板、收藏查询或偏移跳转，可以继续在这套接口基础上平滑演进。
