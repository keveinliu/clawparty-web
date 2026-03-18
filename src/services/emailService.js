const nodemailer = require("nodemailer");
const { getEnv } = require("../config/env");
const { logInfo, logError } = require("../utils/logger");

class EmailService {
  constructor() {
    this.env = getEnv();
    this.transporter = null;
    this.initTransporter();
  }

  initTransporter() {
    if (!this.env.emailUser || !this.env.emailToken) {
      logInfo("email.service.disabled", {
        reason: "Missing EMAIL or EMAIL_TOKEN in environment",
      });
      return;
    }

    this.transporter = nodemailer.createTransport({
      host: "smtp.exmail.qq.com",
      port: 465,
      secure: true,
      auth: {
        user: this.env.emailUser,
        pass: this.env.emailToken,
      },
    });

    logInfo("email.service.initialized", {
      host: "smtp.exmail.qq.com",
      port: 465,
      user: this.env.emailUser,
    });
  }

  isEnabled() {
    return Boolean(this.transporter);
  }

  async sendOrderCreatedEmail(order) {
    if (!this.isEnabled()) {
      logInfo("email.skip", { reason: "Email service not enabled" });
      return { sent: false, reason: "disabled" };
    }

    if (!order.email) {
      logInfo("email.skip", { reason: "No email in order", orderId: order.id });
      return { sent: false, reason: "no_email" };
    }

    try {
      const deliveryTime = new Date(order.deliveryTime).toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
      });

      const mailOptions = {
        from: `"ClawParty" <${this.env.emailUser}>`,
        to: order.email,
        subject: "订单创建成功 - ClawParty",
        html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 8px 8px; }
    .info-box { background: white; padding: 20px; border-radius: 6px; margin: 20px 0; }
    .info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee; }
    .info-row:last-child { border-bottom: none; }
    .label { color: #666; font-weight: 500; }
    .value { color: #333; font-weight: 600; }
    .footer { text-align: center; color: #999; font-size: 12px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🦞 ClawParty</h1>
      <p>订单创建成功</p>
    </div>
    <div class="content">
      <p>您好，</p>
      <p>您的订单已成功创建。请完成支付以激活服务。</p>
      
      <div class="info-box">
        <div class="info-row">
          <span class="label">订单号</span>
          <span class="value">${order.id}</span>
        </div>
        <div class="info-row">
          <span class="label">服务时长</span>
          <span class="value">${order.quantity} 小时</span>
        </div>
        <div class="info-row">
          <span class="label">服务开始时间</span>
          <span class="value">${deliveryTime}</span>
        </div>
        <div class="info-row">
          <span class="label">订单状态</span>
          <span class="value">待支付</span>
        </div>
      </div>

      <p>系统将在服务开始时间自动为您创建云资源，服务结束后自动清理。</p>
      <p>如有任何问题，请联系客服。</p>
      
      <div class="footer">
        <p>此邮件由系统自动发送，请勿回复。</p>
        <p>© 2026 ClawParty. All rights reserved.</p>
      </div>
    </div>
  </div>
</body>
</html>
        `,
      };

      const info = await this.transporter.sendMail(mailOptions);

      logInfo("email.order_created.sent", {
        orderId: order.id,
        to: order.email,
        messageId: info.messageId,
      });

      return { sent: true, messageId: info.messageId };
    } catch (err) {
      logError("email.order_created.error", err, {
        orderId: order.id,
        email: order.email,
      });
      return { sent: false, error: err.message };
    }
  }

  async sendProvisionSuccessEmail(order, dnsName) {
    if (!this.isEnabled()) {
      logInfo("email.skip", { reason: "Email service not enabled" });
      return { sent: false, reason: "disabled" };
    }

    if (!order.email) {
      logInfo("email.skip", { reason: "No email in order", orderId: order.id });
      return { sent: false, reason: "no_email" };
    }

    try {
      const deliveryTime = new Date(order.deliveryTime).toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
      });

      const mailOptions = {
        from: `"ClawParty" <${this.env.emailUser}>`,
        to: order.email,
        subject: "服务已就绪 - ClawParty",
        html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 8px 8px; }
    .info-box { background: white; padding: 20px; border-radius: 6px; margin: 20px 0; }
    .info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee; }
    .info-row:last-child { border-bottom: none; }
    .label { color: #666; font-weight: 500; }
    .value { color: #333; font-weight: 600; }
    .dns-box { background: #e8f5e9; padding: 15px; border-radius: 6px; margin: 20px 0; text-align: center; }
    .dns-name { font-size: 18px; font-weight: 700; color: #2e7d32; font-family: monospace; }
    .footer { text-align: center; color: #999; font-size: 12px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🦞 ClawParty</h1>
      <p>服务已就绪</p>
    </div>
    <div class="content">
      <p>您好，</p>
      <p>您的云资源已成功创建，现在可以使用了！</p>
      
      <div class="dns-box">
        <p style="margin: 0 0 10px 0; color: #666;">您的服务地址</p>
        <div class="dns-name">${dnsName}</div>
      </div>

      <div class="info-box">
        <div class="info-row">
          <span class="label">订单号</span>
          <span class="value">${order.id}</span>
        </div>
        <div class="info-row">
          <span class="label">服务时长</span>
          <span class="value">${order.quantity} 小时</span>
        </div>
        <div class="info-row">
          <span class="label">服务开始时间</span>
          <span class="value">${deliveryTime}</span>
        </div>
        <div class="info-row">
          <span class="label">EC2 实例 ID</span>
          <span class="value">${order.ec2InstanceId || "N/A"}</span>
        </div>
      </div>

      <p><strong>重要提示：</strong></p>
      <ul>
        <li>服务将在 ${order.quantity} 小时后自动停止</li>
        <li>资源停止后将自动清理，请及时保存重要数据</li>
        <li>如需延长服务时间，请重新下单</li>
      </ul>
      
      <div class="footer">
        <p>此邮件由系统自动发送，请勿回复。</p>
        <p>© 2026 ClawParty. All rights reserved.</p>
      </div>
    </div>
  </div>
</body>
</html>
        `,
      };

      const info = await this.transporter.sendMail(mailOptions);

      logInfo("email.provision_success.sent", {
        orderId: order.id,
        to: order.email,
        dnsName,
        messageId: info.messageId,
      });

      return { sent: true, messageId: info.messageId };
    } catch (err) {
      logError("email.provision_success.error", err, {
        orderId: order.id,
        email: order.email,
        dnsName,
      });
      return { sent: false, error: err.message };
    }
  }
}

module.exports = {
  EmailService,
};
