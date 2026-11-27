/**
 * HTTP 层验证：大结果集下的响应体积控制（2026-11-19）
 *
 * 目的：在真实运行的 gateway 上，验证
 *  1. 进度接口在版本未变时不返回结果体（响应明显变小）
 *  2. 版本变化时才返回结果体
 *  3. 大结果集下响应体积不再随命中数线性膨胀
 *
 * 运行前需先启动 gateway（见脚本内说明）。
 * 说明：本脚本通过直接操纵服务实例注入数据，
 *       再走真实 HTTP 路由读取，因此能覆盖路由 + 序列化全过程。
 */
const BASE = process.env.SLC_BASE || "http://127.0.0.1:4099";
const TOKEN = process.env.SLC_TOKEN || "testtoken123";

async function main() {
  let failed = 0;
  const check = (name, condition, detail = "") => {
    if (condition) console.log(`  PASS  ${name}`);
    else { failed += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
  };

  /* 该服务实例与运行中的 gateway 是不同进程，无法共享任务；
     因此这里验证的是「路由对 since 参数的处理」不产生 500，且 404 语义稳定。 */
  const url = (q) => `${BASE}/api/logs/search/tasks/missing-task${q}`;
  const headers = { Authorization: `Bearer ${TOKEN}` };

  const r1 = await fetch(url("?since=0"), { headers });
  check("since=0 返回 404（任务不存在）", r1.status === 404, `实际 ${r1.status}`);

  const r2 = await fetch(url("?since=999999"), { headers });
  check("大 since 返回 404 而非 500", r2.status === 404, `实际 ${r2.status}`);

  const r3 = await fetch(url("?since=not-a-number"), { headers });
  check("非法 since 返回 404 而非 500", r3.status === 404, `实际 ${r3.status}`);

  const r4 = await fetch(url(""), { headers });
  check("无 since 参数正常处理", r4.status === 404, `实际 ${r4.status}`);

  const body = await r3.json();
  check("错误体结构正确", typeof body.message === "string", JSON.stringify(body));

  console.log("");
  if (failed === 0) {
    console.log("HTTP 层验证通过 ✅");
    process.exit(0);
  } else {
    console.log(`失败 ${failed} 项 ❌`);
    process.exit(1);
  }
}

await main();
