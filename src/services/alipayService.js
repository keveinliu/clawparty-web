const AlipaySdk = require("alipay-sdk").default;
const { getEnv } = require("../config/env");
const { logInfo, logError } = require("../utils/logger");

class AlipayService {
  constructor() {
    const env = getEnv();
    this.env = env;
    this.enabled = Boolean(env.alipayAppId && env.alipayPrivateKey && env.alipayPublicKey);

    if (this.enabled) {
      this.sdk = new AlipaySdk({
        appId: env.alipayAppId,
        privateKey: env.alipayPrivateKey,
        alipayPublicKey: env.alipayPublicKey,
        keyType: "PKCS1",
        gateway: env.alipaySandbox
          ? "https://openapi-sandbox.dl.alipaydev.com/gateway.do"
          : "https://openapi.alipay.com/gateway.do",
      });
      logInfo("alipay.service.initialized", { sandbox: env.alipaySandbox });
    }
  }

  isEnabled() {
    return this.enabled;
  }

  async createQrCode({ outTradeNo, totalAmountYuan, subject, notifyUrl }) {
    const result = await this.sdk.exec("alipay.trade.precreate", {
      bizContent: {
        out_trade_no: outTradeNo,
        total_amount: totalAmountYuan,
        subject,
      },
      notifyUrl: notifyUrl || this.env.alipayNotifyUrl,
    });

    if (result.code !== "10000") {
      throw new Error(`Alipay error: ${result.subMsg || result.msg}`);
    }

    logInfo("alipay.qrcode.created", { outTradeNo, qrCode: result.qrCode });
    return result.qrCode;
  }

  verifyNotify(postBody) {
    return this.sdk.checkNotifySign(postBody);
  }
}

module.exports = { AlipayService };
