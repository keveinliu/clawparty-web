# 生产部署指南

本文档说明如何将 Clawparty 部署到云主机并配置有赞支付 webhook。

## 部署前准备

### 1. 云主机要求

- **操作系统**: Ubuntu 20.04+ / CentOS 7+
- **Node.js**: v18.0.0+
- **内存**: 最低 1GB
- **磁盘**: 最低 10GB
- **网络**: 公网 IP，开放端口 80/443

### 2. 域名配置

确保域名已解析到云主机 IP：
```bash
# 添加 A 记录
your-domain.com  →  your-server-ip
```

## 部署步骤

### 1. 安装 Node.js

```bash
# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# CentOS/RHEL
curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo yum install -y nodejs

# 验证安装
node --version
npm --version
```

### 2. 克隆项目

```bash
cd /opt
git clone <your-repo-url> clawparty-web
cd clawparty-web
npm install
```

### 3. 配置环境变量

创建 `.env` 文件：

```bash
# 服务器配置
PORT=3000
NODE_ENV=production

# AWS 配置（生产环境必须启用）
AWS_ENABLED=true
AWS_REGION=us-east-1
AWS_HOSTED_ZONE_ID=Z1234567890ABC
AWS_DOMAIN_SUFFIX=clawparty.ai
AWS_INSTANCE_TYPE=t3a.small
AWS_SECURITY_GROUP_ID=sg-xxxxxxxxx
AWS_SUBNET_ID=subnet-xxxxxxxxx
AWS_AMI_SSM_PATH=/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id

# 有赞支付配置
YOUZAN_CLIENT_ID=your_client_id
YOUZAN_CLIENT_SECRET=your_client_secret
YOUZAN_AUTHORIZE_TYPE=silent
YOUZAN_GRANT_ID=your_grant_id
YOUZAN_WEBHOOK_SECRET=your_webhook_secret
YOUZAN_CHECKOUT_BASE_URL=https://j.youzan.com/YOUR_LINK
YOUZAN_UNIT_PRICE_FEN=100

# 调度器配置
SCHEDULER_CRON="* * * * *"

# 数据目录
DATA_DIR=/opt/clawparty-web/data
```

### 4. 配置 Nginx 反向代理

安装 Nginx：
```bash
sudo apt-get install nginx  # Ubuntu/Debian
sudo yum install nginx      # CentOS/RHEL
```

创建 Nginx 配置 `/etc/nginx/sites-available/clawparty`：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # 重定向到 HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # SSL 证书（使用 Let's Encrypt）
    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # SSL 配置
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # 日志
    access_log /var/log/nginx/clawparty-access.log;
    error_log /var/log/nginx/clawparty-error.log;

    # 反向代理到 Node.js
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Webhook 端点（重要：确保可访问）
    location /webhooks/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Webhook 特殊配置
        proxy_read_timeout 60s;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
    }
}
```

启用配置：
```bash
sudo ln -s /etc/nginx/sites-available/clawparty /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### 5. 配置 SSL 证书（Let's Encrypt）

```bash
# 安装 Certbot
sudo apt-get install certbot python3-certbot-nginx  # Ubuntu/Debian
sudo yum install certbot python3-certbot-nginx      # CentOS/RHEL

# 获取证书
sudo certbot --nginx -d your-domain.com

# 自动续期
sudo certbot renew --dry-run
```

### 6. 配置 PM2（进程管理）

安装 PM2：
```bash
sudo npm install -g pm2
```

创建 PM2 配置文件 `ecosystem.config.js`：

```javascript
module.exports = {
  apps: [{
    name: 'clawparty',
    script: './src/server.js',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
    max_memory_restart: '500M'
  }]
};
```

启动服务：
```bash
# 创建日志目录
mkdir -p logs

# 启动应用
pm2 start ecosystem.config.js

# 查看状态
pm2 status

# 查看日志
pm2 logs clawparty

# 设置开机自启
pm2 startup
pm2 save
```

## 配置有赞支付 Webhook

### 1. 获取 Webhook URL

部署完成后，你的 webhook URL 为：
```
https://your-domain.com/webhooks/youzan/payment-callback
```

### 2. 在有赞商家后台配置

1. 登录有赞商家后台：https://www.youzan.com
2. 进入 **设置 → 开发者中心 → 消息推送**
3. 添加推送 URL：
   ```
   https://your-domain.com/webhooks/youzan/payment-callback
   ```
4. 选择推送事件：
   - ✅ **交易支付成功** (`trade_TradePaid`)
   - ✅ **支付成功** (`trade_TradeSuccess`)

5. 配置签名密钥：
   - 有赞会提供一个 **Webhook Secret**
   - 将此密钥添加到 `.env` 文件：
     ```bash
     YOUZAN_WEBHOOK_SECRET=your_webhook_secret_from_youzan
     ```

6. 保存配置

### 3. 测试 Webhook

有赞提供测试推送功能：

1. 在有赞后台点击 **测试推送**
2. 查看服务器日志：
   ```bash
   pm2 logs clawparty
   # 或
   tail -f logs/pm2-out.log
   ```
3. 应该看到类似日志：
   ```
   Webhook verification failed: Invalid signature
   ```
   或
   ```
   Payment confirmed for order xxx, jobs scheduled
   ```

### 4. Webhook 验证流程

Clawparty 使用以下方式验证 webhook：

1. **签名验证**：
   - 有赞在请求头中发送 `X-Youzan-Signature`
   - 使用 HMAC-SHA256 验证签名
   - 签名密钥来自 `YOUZAN_WEBHOOK_SECRET`

2. **时间戳验证**：
   - 检查 `X-Youzan-Timestamp` 请求头
   - 防止重放攻击

3. **订单验证**：
   - 检查订单是否存在
   - 检查订单状态是否为 `payment_pending`

### 5. Webhook 调试

如果 webhook 不工作，检查：

```bash
# 1. 检查 Nginx 日志
sudo tail -f /var/log/nginx/clawparty-access.log
sudo tail -f /var/log/nginx/clawparty-error.log

# 2. 检查应用日志
pm2 logs clawparty

# 3. 测试 webhook 端点是否可访问
curl -X POST https://your-domain.com/webhooks/youzan/payment-callback \
  -H "Content-Type: application/json" \
  -d '{"test": true}'

# 应该返回 400 或 401（缺少签名），而不是 404 或 502

# 4. 检查防火墙
sudo ufw status
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

### 6. Webhook 安全建议

1. **仅允许有赞 IP 访问**（可选）：
   ```nginx
   location /webhooks/youzan/ {
       # 有赞 webhook IP 白名单（示例，请向有赞确认实际 IP）
       allow 47.96.0.0/16;
       allow 47.97.0.0/16;
       deny all;
       
       proxy_pass http://127.0.0.1:3000;
   }
   ```

2. **启用请求日志**：
   ```nginx
   location /webhooks/ {
       access_log /var/log/nginx/webhook-access.log;
       # ...
   }
   ```

3. **监控 webhook 失败**：
   ```bash
   # 定期检查失败的 webhook
   grep "Webhook verification failed" logs/pm2-out.log
   ```

## 验证部署

### 1. 检查服务状态

```bash
# PM2 状态
pm2 status

# Nginx 状态
sudo systemctl status nginx

# 检查端口
sudo netstat -tlnp | grep :3000
sudo netstat -tlnp | grep :80
sudo netstat -tlnp | grep :443
```

### 2. 测试网站访问

```bash
# 测试首页
curl https://your-domain.com

# 测试 API
curl https://your-domain.com/api/orders

# 测试 webhook 端点
curl -X POST https://your-domain.com/webhooks/youzan/payment-callback
```

### 3. 测试完整流程

1. 访问网站首页
2. 点击"立即订阅"
3. 填写订单信息并提交
4. 完成支付
5. 检查订单状态：
   ```bash
   npm run cli list-orders
   npm run cli list-jobs
   ```

## 监控和维护

### 查看日志

```bash
# PM2 日志
pm2 logs clawparty

# Nginx 日志
sudo tail -f /var/log/nginx/clawparty-access.log
sudo tail -f /var/log/nginx/clawparty-error.log

# 系统日志
sudo journalctl -u nginx -f
```

### 重启服务

```bash
# 重启应用
pm2 restart clawparty

# 重启 Nginx
sudo systemctl restart nginx

# 重新加载 Nginx 配置（无停机）
sudo nginx -s reload
```

### 更新代码

```bash
cd /opt/clawparty-web
git pull
npm install
pm2 restart clawparty
```

### 备份数据

```bash
# 备份订单和任务数据
tar -czf backup-$(date +%Y%m%d).tar.gz data/

# 定期备份（添加到 crontab）
0 2 * * * cd /opt/clawparty-web && tar -czf /backup/clawparty-$(date +\%Y\%m\%d).tar.gz data/
```

## 故障排查

### Webhook 不工作

1. 检查 webhook URL 是否可从公网访问
2. 检查 `YOUZAN_WEBHOOK_SECRET` 是否正确
3. 查看 Nginx 和应用日志
4. 在有赞后台测试推送

### 调度器不执行任务

1. 检查 PM2 进程是否运行
2. 查看调度器状态：`npm run cli show-scheduler`
3. 检查任务列表：`npm run cli list-jobs`
4. 查看应用日志中的调度器错误

### AWS 资源创建失败

1. 检查 AWS 凭证是否正确
2. 检查 IAM 权限
3. 检查 VPC、子网、安全组配置
4. 查看应用日志中的 AWS 错误

## 安全建议

1. **定期更新依赖**：
   ```bash
   npm audit
   npm update
   ```

2. **配置防火墙**：
   ```bash
   sudo ufw enable
   sudo ufw allow 22/tcp
   sudo ufw allow 80/tcp
   sudo ufw allow 443/tcp
   ```

3. **限制 SSH 访问**：
   - 使用密钥认证
   - 禁用 root 登录
   - 修改默认 SSH 端口

4. **监控异常访问**：
   ```bash
   # 安装 fail2ban
   sudo apt-get install fail2ban
   ```

## 性能优化

1. **启用 Nginx 缓存**（静态资源）
2. **配置 PM2 集群模式**（多核 CPU）
3. **使用 Redis 替代 JSON 文件存储**（高并发场景）
4. **配置 CDN**（静态资源加速）

## 支持

如有问题，请查看：
- [README.md](./README.md) - 项目概览
- [PAYMENT.md](./PAYMENT.md) - 支付流程详解
- [AGENTS.md](./AGENTS.md) - 任务调度说明
