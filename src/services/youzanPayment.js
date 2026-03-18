const axios = require("axios");
const { getEnv } = require("../config/env");
const { logInfo, logWarn, logError } = require("../utils/logger");

const TOKEN_EXPIRY_BUFFER_MS = 60 * 1000;

class YouzanPaymentService {
  constructor() {
    this.env = getEnv();
    this.cachedAccessToken = null;
    this.cachedTokenExpiresAt = 0;
  }

  hasApiCredentials() {
    return Boolean(
      this.env.youzanClientId &&
        this.env.youzanClientSecret &&
        this.env.youzanAuthorizeType === "silent" &&
        Number.isFinite(this.env.youzanGrantId)
    );
  }

  async getAccessToken() {
    const now = Date.now();
    if (
      this.cachedAccessToken &&
      this.cachedTokenExpiresAt - TOKEN_EXPIRY_BUFFER_MS > now
    ) {
      logInfo("youzan.token.cached", {
        expiresAt: this.cachedTokenExpiresAt,
      });
      return this.cachedAccessToken;
    }

    const payload = {
      authorize_type: this.env.youzanAuthorizeType,
      client_id: this.env.youzanClientId,
      client_secret: this.env.youzanClientSecret,
      grant_id: this.env.youzanGrantId,
      refresh: true,
    };

    logInfo("youzan.token.request", {
      url: this.env.youzanTokenUrl,
      authorizeType: payload.authorize_type,
      grantId: payload.grant_id,
      timeoutMs: this.env.youzanRequestTimeoutMs,
    });

    const response = await axios.post(this.env.youzanTokenUrl, payload, {
      timeout: this.env.youzanRequestTimeoutMs,
    });

    const body = response.data || {};
    logInfo("youzan.token.response", {
      status: response.status,
      code: body.code,
      success: body.success,
    });

    if (!body.success || !body.data || !body.data.access_token) {
      throw new Error(body.message || "Youzan token request failed");
    }

    const expiresAt = Number(body.data.expires);
    this.cachedAccessToken = body.data.access_token;
    this.cachedTokenExpiresAt = Number.isFinite(expiresAt)
      ? expiresAt
      : Date.now() + 24 * 60 * 60 * 1000;

    return this.cachedAccessToken;
  }

  fallbackSession(order, paymentSessionId, reason) {
    const checkoutUrl = this.env.youzanCheckoutBaseUrl || "";
    logWarn("youzan.payment_session.fallback", {
      orderId: order.id,
      paymentSessionId,
      checkoutUrl,
      reason,
    });

    return {
      paymentSessionId,
      checkoutUrl,
      provider: "youzan_checkout_link",
      qrId: null,
      qrCodeUrl: null,
      qrUrl: null,
      mode: "fallback",
    };
  }

  async createPaymentSession(order, paymentSessionId) {
    const requestStart = Date.now();
    logInfo("youzan.payment_session.start", {
      orderId: order.id,
      paymentSessionId,
      quantity: Number(order.quantity || 0),
    });

    if (this.env.mockPaymentEnabled) {
      return this.fallbackSession(order, paymentSessionId, "mock_mode_enabled");
    }

    if (!this.hasApiCredentials()) {
      return this.fallbackSession(order, paymentSessionId, "missing_api_credentials");
    }

    try {
      const accessToken = await this.getAccessToken();
      const qrPrice = Math.max(1, Number(order.quantity || 1)) *
        Math.max(1, Number(this.env.youzanUnitPriceFen || 100));
      const apiUrl = `${this.env.youzanApiBaseUrl}/youzan.pay.qrcode.create/3.0.0`;
      const requestBody = {
        qr_price: qrPrice,
        qr_name: `Clawparty ${order.id.slice(0, 8)}`,
        qr_type: "QR_TYPE_FIXED",
      };

      logInfo("youzan.qrcode.request", {
        orderId: order.id,
        url: apiUrl,
        api: "youzan.pay.qrcode.create",
        version: "3.0.0",
        requestBody,
      });

      const response = await axios.post(apiUrl, requestBody, {
        params: {
          access_token: accessToken,
        },
        timeout: this.env.youzanRequestTimeoutMs,
      });

      const body = response.data || {};

      if (body.gw_err_resp) {
        const gwErr = body.gw_err_resp;
        logError("youzan.qrcode.gw_error", new Error(gwErr.err_msg), {
          orderId: order.id,
          errCode: gwErr.err_code,
          traceId: gwErr.trace_id,
        });
        return this.fallbackSession(order, paymentSessionId, `gw_error_${gwErr.err_code}`);
      }

      logInfo("youzan.qrcode.response", {
        orderId: order.id,
        status: response.status,
        success: body.success,
        code: body.code,
        qrId: body.data?.qr_id || null,
      });

      if (!body.success || !body.data) {
        throw new Error(body.message || "Youzan qrcode creation failed");
      }

      const data = body.data;
      const durationMs = Date.now() - requestStart;

      logInfo("youzan.payment_session.success", {
        orderId: order.id,
        paymentSessionId,
        durationMs,
        mode: "api",
        qrId: data.qr_id || null,
      });

      return {
        paymentSessionId,
        checkoutUrl:
          this.env.youzanCheckoutBaseUrl || data.qr_code || data.qr_url || "",
        provider: "youzan_qrcode",
        qrId: data.qr_id || null,
        qrCodeUrl: data.qr_code || null,
        qrUrl: data.qr_url || null,
        mode: "api",
      };
    } catch (err) {
      const durationMs = Date.now() - requestStart;
      logError("youzan.payment_session.error", err, {
        orderId: order.id,
        paymentSessionId,
        durationMs,
      });

      if (this.env.youzanCheckoutBaseUrl) {
        return this.fallbackSession(order, paymentSessionId, "api_error");
      }

      throw err;
    }
  }
}

module.exports = {
  YouzanPaymentService,
};
