# Clawparty 订阅网站实施计划

## 1. 目标

- 使用 Node.js（Express + EJS）搭建 Clawparty 介绍与订阅下单网站。
- 首页展示 Clawparty 核心内容，并在显眼位置提供“立即订阅”入口。
- 完成单商品下单流程：数量选择、配送时间选择、手机号输入。
- 对接有赞支付（商品链接：`https://j.youzan.com/Y4aR8H`），支付成功后驱动 AWS 自动化。
- 支付成功后创建两个任务：
  - 任务 A（Provision）：在配送时间创建 AWS EC2 并创建 Route53 A 记录。
  - 任务 B（Cleanup）：在任务 A 成功后 N 小时关闭 EC2 并删除 DNS 记录，N = 订单商品数量（`quantity`）。

## 2. 范围

### In Scope

- Web 页面：首页、下单页。
- API：创建订单、创建支付会话、支付成功回调、订单查询。
- 任务调度：支付成功后落地两个任务（`provision` + `cleanup`）。
- AWS Provision：AMI 查询、EC2 创建、Route53 A 记录 UPSERT。
- AWS Cleanup：EC2 Stop + Route53 A 记录删除。
- 文档产出：`plan/`、`spec/`、`agents.md`、`AGENTS.md` 及 agents 子文档。

### Out of Scope

- 生产级数据库与分布式锁（当前使用 JSON 文件存储用于快速落地）。
- 多商品 SKU、优惠券、库存扣减。
- 有赞商家后台配置自动化。

## 3. 里程碑

1. **M1 基础脚手架**
   - 建立 Express 应用、模板、静态资源与 API 路由。
2. **M2 下单与支付链路**
   - 订单创建、支付会话创建、支付成功确认。
3. **M3 调度与 AWS 自动化**
   - 支付成功创建 2 个任务：配送时创建实例与 DNS；实例创建成功后按 `quantity` 小时延迟清理资源。
4. **M4 文档与验证**
   - 完成 spec 与 agent 文档，执行测试与运行校验。

## 4. 技术方案

- **框架**：Node.js + Express + EJS。
- **存储**：`data/*.json`（订单、任务）。
- **定时任务**：`node-cron` 每分钟扫描到期任务。
- **任务依赖**：cleanup 任务依赖 provision 任务成功。
- **时间规则**：`cleanupScheduledTime = provisionCompletedAt + quantity * 1h`。
- **云资源**：AWS SDK v3（EC2/SSM/Route53）。
- **支付接入**：有赞 webhook 验签，`.env` 提供真实凭证进行联调。

## 5. 风险与缓解

- **有赞回调字段差异**：
  - 缓解：在 webhook 层做签名和时间戳校验，并保留 mock 回调兜底。
- **本地无 Redis/消息队列**：
  - 缓解：先用 cron + 持久化任务表实现最小可用版本。
- **AWS 权限不足或配额限制**：
  - 缓解：默认支持 mock 模式，真实环境通过最小权限 IAM + 监控告警。
- **cleanup 失败导致资源残留**：
  - 缓解：cleanup 任务幂等、失败重试，并输出可人工清理的资源标识。

## 6. 验收标准

- 首页可见 Clawparty 介绍与“立即订阅”按钮。
- 下单页可提交数量、配送时间、手机号并创建订单。
- 支付接口可生成支付会话；支付成功后创建 2 条任务（provision + cleanup）。
- 到达配送时间后可执行 EC2 + Route53 创建流程（或 mock 模式模拟成功）。
- 创建成功后系统按 `quantity` 小时延迟执行 cleanup：关闭 EC2 并删除 DNS 记录。
- 文档与实现语义一致，服务可正常启动并通过测试。
