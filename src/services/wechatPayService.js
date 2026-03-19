const { WechatPay, Rsa, Aes } = require("wechatpay-axios-plugin");
const { getEnv } = require("../config/env");
const { logInfo, logError } = require("../utils/logger");

class WechatPayService {
  constructor() {
    const env = getEnv();
    this.env = env;
    this.enabled = Boolean(
      env.wechatPayMchid &&
      env.wechatPaySerial &&
      env.wechatPayPrivateKey &&
      env.wechatPayPubkeyId &&
      env.wechatPayPubkey &&
      env.wechatPayApiV3Key &&
      env.wechatPayAppId
    );

    if (this.enabled) {
      const privateKey = Rsa.from(env.wechatPayPrivateKey, Rsa.KEY_TYPE_PRIVATE);
      const publicKey = Rsa.from(env.wechatPayPubkey, Rsa.KEY_TYPE_PUBLIC);

      this.apiV3Key = env.wechatPayApiV3Key;
      this.pubkeyId = env.wechatPayPubkeyId;
      this.pubkey = publicKey;

      this.client = new WechatPay({
        mchid: env.wechatPayMchid,
        serial: env.wechatPaySerial,
        privateKey,
        certs: { [env.wechatPayPubkeyId]: publicKey },
      });
    }
  }

  isEnabled() {
    return this.enabled;
  }

  async createQrCode({ outTradeNo, description, totalFen, notifyUrl }) {
    const env = this.env;
    const { data } = await this.client.v3.pay.transactions.native.post({
      appid: env.wechatPayAppId,
      mchid: env.wechatPayMchid,
      description,
      out_trade_no: outTradeNo,
      notify_url: notifyUrl || env.wechatPayNotifyUrl,
      amount: { total: totalFen, currency: "CNY" },
    });

    logInfo("wechat.qrcode.created", { outTradeNo, codeUrl: data.code_url });
    return data.code_url;
  }

  verifyNotify(headers, rawBody) {
    const timestamp = headers["wechatpay-timestamp"];
    const nonce = headers["wechatpay-nonce"];
    const signature = headers["wechatpay-signature"];
    const serial = headers["wechatpay-serial"];

    const message = `${timestamp}\n${nonce}\n${rawBody}\n`;

    if (serial !== this.pubkeyId) {
      throw new Error(`Unknown Wechatpay-Serial: ${serial}`);
    }

    const valid = Rsa.verify(message, signature, this.pubkey);
    if (!valid) {
      throw new Error("WeChat Pay notify signature verification failed");
    }

    const body = JSON.parse(rawBody);
    const { ciphertext, nonce: resNonce, associated_data } = body.resource;
    const plaintext = Aes.AesGcm.decrypt(ciphertext, this.apiV3Key, resNonce, associated_data);
    return JSON.parse(plaintext);
  }
}

module.exports = { WechatPayService };
