const QRCode = require("qrcode");
const { v4: uuidv4 } = require("uuid");
const { AlipayService } = require("./alipayService");
const { WechatPayService } = require("./wechatPayService");
const { getEnv } = require("../config/env");
const { logInfo, logWarn } = require("../utils/logger");

class PaymentService {
  constructor() {
    this.env = getEnv();
    this.alipay = new AlipayService();
    this.wechat = new WechatPayService();
  }

  isMockEnabled() {
    return this.env.mockPaymentEnabled;
  }

  totalFen(quantity) {
    return Math.max(1, Number(quantity)) * Math.max(1, this.env.unitPriceFen);
  }

  totalYuan(quantity) {
    return (this.totalFen(quantity) / 100).toFixed(2);
  }

  async createQrCode({ orderId, quantity, paymentMethod }) {
    const outTradeNo = orderId.replace(/-/g, "").slice(0, 32);
    const subject = `ClawParty 订阅 ${quantity}小时`;

    if (this.isMockEnabled()) {
      logInfo("payment.mock.qrcode", { orderId, paymentMethod });
      const mockUrl = `https://mock-pay.example.com/${paymentMethod}/${outTradeNo}`;
      const qrDataUrl = await QRCode.toDataURL(mockUrl);
      return { qrDataUrl, outTradeNo, provider: paymentMethod, mock: true };
    }

    let rawUrl;

    if (paymentMethod === "alipay") {
      if (!this.alipay.isEnabled()) {
        throw new Error("Alipay not configured");
      }
      rawUrl = await this.alipay.createQrCode({
        outTradeNo,
        totalAmountYuan: this.totalYuan(quantity),
        subject,
      });
    } else if (paymentMethod === "wechat") {
      if (!this.wechat.isEnabled()) {
        throw new Error("WeChat Pay not configured");
      }
      rawUrl = await this.wechat.createQrCode({
        outTradeNo,
        description: subject,
        totalFen: this.totalFen(quantity),
      });
    } else {
      throw new Error(`Unknown payment method: ${paymentMethod}`);
    }

    const qrDataUrl = await QRCode.toDataURL(rawUrl);
    logInfo("payment.qrcode.created", { orderId, paymentMethod, outTradeNo });
    return { qrDataUrl, outTradeNo, provider: paymentMethod, mock: false };
  }
}

module.exports = { PaymentService };
