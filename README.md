# Webster 孤立交叉口配时服务

只做**孤立交叉口的解析配时**：Webster 最佳周期、有效绿分配、均匀延误、饱和判定与候选周期扫描。
经 HTTP 供上游配时工具调用，不做路网仿真、不带界面。

- Node.js 20 + TypeScript（严格模式）
- Web 层：Fastify 4
- 工况档持久化：PostgreSQL 16（`phases` 以 JSONB 存储）
- 无外部计算依赖，闭式公式全部在 `src/domain/` 内，纯函数、可独立测试

---

## 一次构建拉起（服务 + 数据库）

```bash
docker compose up --build
# -> http://localhost:8080
# 启动时自动建表并写入预置四相位算例 demo-four-phase
```

无 Docker 时本地跑（无数据库自动回退内存仓储，预置算例运行时写入）：

```bash
npm ci
npm run build
STORAGE=memory node dist/app.js
# 或显式要求 PG（连不上直接失败，不静默降级）：
STORAGE=postgres PGHOST=localhost PGUSER=webster PGPASSWORD=webster PGDATABASE=webster node dist/app.js
```

健康检查：`GET /health`

---

## 核算链与公式

所有请求先走同一套顺序，**校验卡在公式之前**：

1. **校验**：相位数 ≥ 2；每个相位 `q ≥ 0`、`s > 0`；`lostTime > 0`；`minGreen ≥ 0`（若给）。
2. **流量比**：`y_i = q_i / s_i`，`Y = Σ y_i`。
3. **最佳周期（Webster）**：`C0 = (1.5·L + 5) / (1 − Y)`。
4. **有效绿分配**：`g_i = (C − L) · y_i / Y`，硬约束 `Σg_i + L ≡ C`，
   浮点残差压进 `1e-6 s`（残差并入 y 最大相位后复核，凑不平直接拒绝）。
5. **饱和度**：`x_i = q_i/(λ_i s_i) = y_i/λ_i`，`λ_i = g_i/C`；任一 `x_i ≥ 1` 单独报相位饱和。
6. **均匀延误（Webster 第一项）**：
   `d1_i = 0.5·C·(1−λ_i)² / (1−λ_i·x_i)`（秒/辆）。
   相位延误率 `q_i·d1_i`（秒/小时），合计延误为各相位之和。
   另提供 Webster 第二项（随机/增量）`d2 = 1800·x²/(q·(1−x))`，用 `model=webster-full` 打开
   （扫描默认用它，这样曲线呈先降后升；`uniform-only` 严格只取第一项）。

**流量比与延误共用同一组到达率**：二者在 `analyze()` 一次调用内由同一份归一化的 `q/s` 算出，
相位评估里还有一道 `y ≡ q/s` 的一致性断言，杜绝「配时用一套 q、延误用另一套 q」。

### 饱和边界（两层）

- **整体**：`Y ≥ 0.99`（离 1 不足 0.01 的裕度）即判过饱和，**求解前**返回
  `OVERSATURATED` 并附 `Y`，绝不产生负周期或几千秒的假周期；自动周期与指定周期两条路径一致拒绝。
- **相位**：`Y < 1` 时某个相位仍可能因绿灯被挤占而 `x_i ≥ 1`，返回
  `PHASE_SATURATED`（带相位下标与 x），不默默输出无物理意义的延误。
- **最小绿**：先保住各 `minGreen`，剩余有效绿再按流量比分配；`ΣminGreen > C−L` 时返回
  `MIN_GREEN_INFEASIBLE`，不把任何相位悄悄削成零。

---

## HTTP 接口

### 1) 配时：`POST /api/timing`
返回 `Y`、`optimalCycle`、各相位 `y/g/lambda`（不返回延误）。

```bash
curl -s -X POST localhost:8080/api/timing -H 'content-type: application/json' -d '{
  "lostTime": 12,
  "phases": [
    {"name": "东西直行", "q": 360, "s": 1800},
    {"name": "东西左转", "q": 450, "s": 1800},
    {"name": "南北直行", "q": 255, "s": 1700},
    {"name": "南北左转", "q": 170, "s": 1700}
  ]
}'
# Y=0.7, optimalCycle≈76.67s
```

### 2) 延误：`POST /api/delay`
体同上，可加 `cycle`（另指定周期，缺省用 C0）与 `model`。
返回各相位 `x / uniformDelay / q·d`、`balanceResidual` 与 `totalDelay`。

```bash
curl -s -X POST localhost:8080/api/delay -H 'content-type: application/json' \
  -d '{"lostTime":12,"cycle":60,"phases":[...同上...]}'
```

### 3) 扫描：`POST /api/scan`
`fromCycle / toCycle / step / model`（缺省围绕 C0 自动取范围、步长 10s）。
**每个点都用该周期那套绿信比现算**，不回放预制曲线。不可行周期保留为
`feasible:false` 并带 `code/reason`。长作业可中断：客户端断连即 `AbortController` 取消，
半条点列绝不会被当作完整结果发送。

```bash
curl -s -X POST localhost:8080/api/scan -H 'content-type: application/json' \
  -d '{"lostTime":12,"fromCycle":45,"toCycle":300,"step":15,"phases":[...]}'
```

### 工况档（按名字建档 / 取回 / 重算）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/scenarios` | 列出 |
| POST | `/api/scenarios` | 建档（重名 409） |
| GET | `/api/scenarios/:name` | 取回 |
| PUT | `/api/scenarios/:name` | 更新 |
| DELETE | `/api/scenarios/:name` | 删除（预置档受保护） |
| POST | `/api/scenarios/:name/recompute` | 凭存档核算（body 可带 `cycle/model`） |
| POST | `/api/scenarios/:name/scan` | 凭存档扫描（同样可中断） |

预置档：`demo-four-phase`（四相位，Y=0.70，L=12s，C0≈76.7s）。

### 错误结构

```json
{ "error": "OVERSATURATED", "reason": "…", "details": { "Y": 0.995 }, "fields": [] }
```

| code | HTTP | 触发 |
| --- | --- | --- |
| `INVALID_INPUT` / `INVALID_CYCLE` / `INVALID_SCAN_RANGE` | 400 | 形状或数值非法 |
| `OVERSATURATED` / `PHASE_SATURATED` / `MIN_GREEN_INFEASIBLE` | 422 | 物理不可行 |
| `SCENARIO_NOT_FOUND` / `SCENARIO_EXISTS` | 404 / 409 | 工况档 |
| `SCAN_CANCELLED` | 499 | 扫描被取消（正常由断连触发，响应不会真正发出） |

---

## 模块边界

```
src/
  domain/
    types.ts          # 领域类型
    errors.ts         # 统一错误结构与 code
    validation.ts     # 输入校验（卡在公式之前）
    flowRatios.ts     # y = q/s, Y = Σy
    cycle.ts          # C0 与整体过饱和判定（0.99 裕度）
    greenSplit.ts     # 有效绿分配、最小绿、Σg+L=C 配平
    saturation.ts     # 相位级 x 与饱和判定
    delay.ts          # Webster 第一/第二项
    analyze.ts        # 核算单一事实源（一条链走完，共用同一组 q）
    scan.ts           # 可中断周期扫描（逐点现算）
    presets.ts        # 预置四相位算例
  persistence/
    repository.ts         # 仓储接口（测试注入内存实现）
    memoryRepository.ts   # 内存实现
    pgRepository.ts       # PostgreSQL 16 实现 + migrate
    schema.sql            # 建表 + 预置算例
  http/
    schemas.ts        # zod 形状校验
    errorHandler.ts   # code -> HTTP
    timingRoutes.ts   # /timing /delay /scan
    scenarioRoutes.ts # /scenarios*
    server.ts         # 装配
  app.ts              # 入口（PG 就绪等待/迁移、信号关闭）
```

闭式配时与延误扫描分处独立文件，互不堆放。

## 自动化测试

```bash
npm test                      # 87 个单元/HTTP 测试（PG 集成套件默认 skip）
npm run test:pg               # 直连 PG 跑集成（需 RUN_PG_TESTS=1 与 PG* 环境）
docker compose --profile test build test
docker compose --profile test run --rm test   # 在构建产物上跑全部，含对 PG16 的集成
```

覆盖（对应需求逐条落锁）：

- 四相位算例数量级：Y=0.70、C0≈76.7s、合计延误量级；
- 校验先于公式：相位<2、q<0、s≤0、L≤0、非有限值、最小绿<0；
- **损失只增 → C0 上升、各相位均匀延误不下降、绿信比被压缩**；
- **单相位 q 加倍（Y 仍 <1）→ 该相位 y 与 λ 上升、其余相位 λ 被挤占**；
- **Y→1 周期急剧变大（460s@0.95、1150s@0.98），越界后两条路径都拒绝**；
- **指定周期恰等于 C0 → λ 与延误与自动周期容差内一致**；
- **Σg+L=C 在多个周期（含非整数 C0）严格成立**；
- 整体过饱和、相位饱和、最小绿保不住三类拒绝；
- 扫描逐点与 `analyze(cycle)` 现算相等、U 形谷底、不可行点保留、范围非法；
- 扫描开始前/中途取消：抛 `SCAN_CANCELLED`，不返回半点列；真实 TCP 断连测试；
- **并发隔离**：30 份不同工况并行核算逐一与串行结果吻合；多扫描互不串状态；
- 流量比/饱和度/延误率与回显 q/s 自洽（防两套 q）；
- 工况档 CRUD 与 PG16 数据往返集成。
