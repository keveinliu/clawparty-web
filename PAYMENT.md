# 支付流程说明

## 支付提供商

Clawparty 使用**有赞支付**（Youzan）作为支付提供商。

## 支付流程

### 1. 创建订单
用户在下单页面填写：
- 数量（小时数）
- 配送时间
- 手机号

提交后创建订单，状态为 `created`。

### 2. 生成支付会话
前端调用 `POST /api/orders/:id/payment-session`，后端：
- 调用有赞 API 创建支付二维码（`youzan.pay.qrcode.create`）
- 返回支付链接（`checkoutUrl`）和二维码图片（`qrCodeUrl`）
- 订单状态更新为 `payment_pending`

### 3. 用户支付
用户跳转到有赞支付页面或扫描二维码完成支付。

### 4. 支付回调（Webhook）
**重要：有赞支付不会自动跳转回网站。**

支付成功后，有赞通过 webhook 通知服务器：
- Webhook 端点：`POST /webhooks/youzan/payment-callback`
- 验证签名和时间戳
- 更新订单状态为 `provisioning_scheduled`
- 创建 provision 和 cleanup 任务

### 5. 用户手动返回
用户需要手动关闭支付页面，返回网站查看订单状态。

## 支付成功追踪

### 方式 1：Webhook 日志
查看服务器日志：
```bash
# 查看 webhook 处理日志
grep "Payment confirmed" logs/app.log
grep "Webhook verification" logs/app.log
```

### 方式 2：订单状态查询
使用 CLI 工具：
```bash
npm run cli list-orders
```

查看订单状态：
- `payment_pending` - 等待支付
- `provisioning_scheduled` - 支付成功，任务已调度
- `provisioning` - 正在创建资源
- `active` - 资源已创建
- `complete` - 资源已清理

### 方式 3：API 查询
```bash
curl http://localhost:3000/api/orders/:orderId
```

### 方式 4：任务列表
```bash
npm run cli list-jobs
```

查看是否创建了 provision 和 cleanup 任务。

## 为什么不自动跳转？

有赞支付使用二维码支付模式，用户在第三方页面完成支付。支付完成后：
- **有赞不提供 success_url 自动跳转功能**
- 必须通过 webhook 异步通知服务器
- 用户需要手动返回网站

这是有赞支付的设计限制，不是配置问题。

## 测试支付流程

### Mock 模式（开发环境）
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

### 真实支付（生产环境）
1. 配置有赞凭证（`.env`）：
   ```bash
   YOUZAN_CLIENT_ID=your_client_id
   YOUZAN_CLIENT_SECRET=your_client_secret
   YOUZAN_AUTHORIZE_TYPE=silent
   YOUZAN_GRANT_ID=your_grant_id
   ```

2. 在有赞商家后台配置 webhook URL：
   ```
   https://your-domain.com/webhooks/youzan/payment-callback
   ```

3. 确保 webhook 签名密钥已配置：
   ```bash
   YOUZAN_WEBHOOK_SECRET=your_webhook_secret
   ```

## 常见问题

### Q: 支付成功但订单状态未更新？
A: 检查：
1. Webhook 是否正确配置
2. 服务器日志是否有 webhook 请求
3. 签名验证是否通过

### Q: 如何确认支付是否成功？
A: 
1. 查看有赞商家后台订单列表
2. 使用 CLI 查看订单状态：`npm run cli list-orders`
3. 检查是否创建了任务：`npm run cli list-jobs`

### Q: 可以添加自动跳转吗？
A: 有赞二维码支付模式不支持自动跳转。如需自动跳转，需要：
1. 切换到其他支付提供商（如 Stripe）
2. 或在前端轮询订单状态，检测到支付成功后自动跳转

## CLI 命令参考

```bash
# 查看所有订单
npm run cli list-orders

# 查看所有任务
npm run cli list-jobs

# 查看调度器状态
npm run cli show-scheduler

# 显示帮助
npm run cli help
```
