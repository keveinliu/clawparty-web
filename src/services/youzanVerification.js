const crypto = require("crypto");
const { getEnv } = require("../config/env");

class YouzanVerification {
  constructor() {
    const env = getEnv();
    this.clientSecret = env.youzanClientSecret;
    this.kdt_id = env.youzanGrantId;
  }

  verifySign(rawBody, eventSign) {
    if (!this.clientSecret) {
      console.warn("YOUZAN_CLIENT_SECRET not configured, skipping signature verification");
      return true;
    }
    const computed = crypto
      .createHash("md5")
      .update(this.clientSecret + rawBody + this.clientSecret)
      .digest("hex");
    return computed === eventSign;
  }

  verify(rawBody, eventSign) {
    if (!eventSign) {
      return { valid: false, reason: "Missing event-sign header" };
    }
    if (!this.verifySign(rawBody, eventSign)) {
      const computed = crypto
        .createHash("md5")
        .update(this.clientSecret + rawBody + this.clientSecret)
        .digest("hex");
      console.warn("Signature mismatch. received:", eventSign, "computed:", computed);
      return { valid: false, reason: "Signature mismatch" };
    }
    return { valid: true, reason: null };
  }
}

module.exports = { YouzanVerification };
