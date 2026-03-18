const crypto = require("crypto");
const { getEnv } = require("../config/env");

class YouzanVerification {
  constructor() {
    const env = getEnv();
    this.clientId = env.youzanClientId;
    this.clientSecret = env.youzanClientSecret;
  }

  verifySign(rawBody, eventSign) {
    if (!this.clientId || !this.clientSecret) {
      console.warn("YOUZAN credentials not configured, skipping signature verification");
      return true;
    }
    const computed = crypto
      .createHash("md5")
      .update(this.clientId + rawBody + this.clientSecret)
      .digest("hex");
    return computed === eventSign;
  }

  verify(rawBody, eventSign) {
    if (!eventSign) {
      return { valid: false, reason: "Missing event-sign header" };
    }
    if (!this.verifySign(rawBody, eventSign)) {
      return { valid: false, reason: "Signature mismatch" };
    }
    return { valid: true, reason: null };
  }
}

module.exports = { YouzanVerification };
