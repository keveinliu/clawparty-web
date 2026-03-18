const crypto = require("crypto");
const { getEnv } = require("../config/env");

class YouzanVerification {
  constructor() {
    const env = getEnv();
    this.clientSecret = env.youzanClientSecret;
    this.skewSeconds = env.youzanWebhookSkewSeconds;
  }

  verifySignature(payload, signature) {
    if (!this.clientSecret) {
      console.warn("YOUZAN_CLIENT_SECRET not configured, skipping signature verification");
      return true;
    }

    const computed = crypto
      .createHmac("sha256", this.clientSecret)
      .update(payload)
      .digest("hex");

    return computed === signature;
  }

  verifyTimestamp(timestamp) {
    if (!Number.isFinite(timestamp)) {
      return false;
    }

    const now = Math.floor(Date.now() / 1000);
    const diff = Math.abs(now - timestamp);
    return diff <= this.skewSeconds;
  }

  verify(payload, signature, timestamp) {
    if (!Number.isFinite(timestamp)) {
      return {
        valid: false,
        reason: "Invalid timestamp",
      };
    }

    if (!this.verifyTimestamp(timestamp)) {
      return {
        valid: false,
        reason: "Timestamp skew exceeded",
      };
    }

    if (!this.verifySignature(payload, signature)) {
      return {
        valid: false,
        reason: "Signature mismatch",
      };
    }

    return {
      valid: true,
      reason: null,
    };
  }
}

module.exports = {
  YouzanVerification,
};
