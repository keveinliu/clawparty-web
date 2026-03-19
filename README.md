# Clawparty

订阅式云资源自动化服务。按需订购云主机时长，系统在指定时间自动创建 EC2 实例与 DNS 记录，到期后自动清理资源。

## 功能特性

- ⏰ **定时交付** - 选择配送时间，系统准时创建云资源
- 🤖 **全自动化** - EC2 实例创建、DNS 配置、资源清理全程自动
- ⏱️ **按时计费** - 订购几小时付几小时，到期自动关闭
- 📦 **开箱即用** - 支付完成即可使用，无需复杂配置

## 快速开始

### 安装依赖

```bash
npm install
```

### 配置环境变量

创建 `.env` 文件：

```bash
# AWS 配置
AWS_ENABLED=false                    # 开发环境设为 false，生产环境设为 true
AWS_REGION=us-east-1
AWS_HOSTED_ZONE_ID=Z1234567890ABC
AWS_DOMAIN_SUFFIX=clawparty.ai
AWS_INSTANCE_TYPE=t3a.small
AWS_SECURITY_GROUP_ID=sg-xxx
AWS_SUBNET_ID=subnet-xxx

# 支付配置
MOCK_PAYMENT_ENABLED=false
UNIT_PRICE_FEN=100

# 支付宝配置
ALIPAY_APP_ID=
ALIPAY_PRIVATE_KEY=
ALIPAY_PUBLIC_KEY=
ALIPAY_NOTIFY_URL=https://domain.com/webhooks/alipay/notify

# 微信支付配置
WECHAT_PAY_MCHID=
WECHAT_PAY_SERIAL=
WECHAT_PAY_PRIVATE_KEY=
WECHAT_PAY_PUBKEY_ID=
WECHAT_PAY_PUBKEY=
WECHAT_PAY_API_V3_KEY=
WECHAT_PAY_APP_ID=
WECHAT_PAY_NOTIFY_URL=https://domain.com/webhooks/wechat/notify

# 调度器配置
SCHEDULER_CRON="* * * * *"           # 每分钟执行一次
```

### 启动服务

```bash
# 开发模式（自动重启）
npm run dev

# 生产模式
npm start
```

服务将在 `http://localhost:3000` 启动。

## CLI 命令

Clawparty 提供命令行工具用于查看订单、任务和调度器状态。

### 查看所有订单

```bash
npm run cli list-orders
```

显示所有订单的详细信息，包括：
- 订单 ID、状态、数量、手机号
- 配送时间、创建时间
- 关联的任务 ID（provision/cleanup）
- EC2 实例 ID 和 DNS 记录 ID

### 查看所有任务

```bash
npm run cli list-jobs
```

显示所有调度任务，包括：
- 任务类型（provision/cleanup）
- 任务状态（pending/completed/failed）
- 计划执行时间、实际完成时间
- 任务依赖关系和延迟时间

### 查看调度器状态

```bash
npm run cli show-scheduler
```

显示调度器运行状态：
- Cron 表达式和数据目录
- 订单总数、任务总数
- 待执行任务、逾期任务
- 即将执行的任务列表（最近 5 个）

### 显示帮助

```bash
npm run cli help
```

## 支付流程

Clawparty 使用支付宝和微信 Native 扫码支付。

### 支付方式

支持两种支付方式：
1. **支付宝**：通过 `alipay.trade.precreate` 接口生成二维码
2. **微信支付**：通过 `/v3/pay/transactions/native` 接口生成二维码

### 订单流转

1. 用户在下单页 (`checkout.ejs`) 提交订单。
2. 跳转到支付页 (`payment.ejs`)，选择支付宝或微信支付。
3. 前端展示支付二维码，并轮询订单状态。
4. 用户扫码支付后，支付宝/微信通过 webhook 异步通知服务器。
5. 服务器验签并更新订单状态，触发资源创建任务。
6. 前端轮询到支付成功状态，自动跳转到成功页。

### 追踪支付成功

```bash
# 查看订单状态
npm run cli list-orders

# 查看任务是否创建
npm run cli list-jobs

# 查看服务器日志
grep "Payment confirmed" logs/app.log
```

## 项目结构

```
clawparty-web/
├── src/
│   ├── app.js              # Express 应用配置
│   ├── server.js           # 服务器入口
│   ├── scheduler.js        # 任务调度器
│   ├── cli.js              # CLI 工具
│   ├── routes/             # 路由
│   │   ├── api.js          # API 路由（订单、支付）
│   │   └── webhooks.js     # Webhook 路由（支付回调）
│   ├── services/           # 业务逻辑
│   │   ├── awsProvisioning.js
│   │   ├── alipayService.js
│   │   ├── wechatPayService.js
│   │   └── paymentService.js
│   ├── models/             # 数据模型
│   │   └── order.js
│   └── config/             # 配置
│       └── env.js
├── views/                  # EJS 模板
│   ├── index.ejs           # 首页
│   ├── checkout.ejs        # 下单页
│   ├── payment.ejs         # 支付二维码页
│   └── success.ejs         # 订单成功页
├── data/                   # 数据存储（JSON）
│   ├── orders.json         # 订单数据
│   └── jobs.json           # 任务数据
├── agents/                 # Agent 文档
├── spec/                   # 技术规范
├── AGENTS.md               # Agent 总览
├── PAYMENT.md              # 支付流程说明
└── package.json
```

## 开发

### 运行测试

```bash
npm test
```

### Mock 支付（开发环境）

设置 `.env`：
```bash
MOCK_PAYMENT_ENABLED=true
```

使用 mock 端点模拟支付成功：
```bash
curl -X POST http://localhost:3000/webhooks/mock/payment-success \
  -H "Content-Type: application/json" \
  -d '{"orderId": "your-order-id"}'
```

## 生产部署

详细的生产部署配置请参考 [DEPLOYMENT.md](./DEPLOYMENT.md)。

## 文档

- [AGENTS.md](./AGENTS.md) - Agent 架构和任务调度说明
- [PAYMENT.md](./PAYMENT.md) - 支付流程和 webhook 配置
- [spec/](./spec/) - API 规范和架构文档

## License

ISC
