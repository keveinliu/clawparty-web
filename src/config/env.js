const path = require("path");
const dotenv = require("dotenv");

dotenv.config();

function boolFromEnv(value, fallback = false) {
  if (value === undefined) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

function getEnv(overrides = {}) {
  const source = {
    ...process.env,
    ...overrides,
  };

  return {
    port: Number(source.PORT || 3000),
    dataDir: source.DATA_DIR || path.join(PROJECT_ROOT, "data"),
    appBaseUrl: source.APP_BASE_URL || "http://localhost:3000",
    schedulerCron: source.SCHEDULER_CRON || "* * * * *",
    mockPaymentEnabled: boolFromEnv(source.MOCK_PAYMENT_ENABLED, true),

    awsEnabled: boolFromEnv(source.AWS_ENABLED, false),
    awsRegion: source.AWS_REGION || "us-east-1",
    awsHostedZoneId: source.AWS_HOSTED_ZONE_ID || "",
    awsDomainSuffix: source.AWS_DOMAIN_SUFFIX || "clawparty.ai",
    awsInstanceType: source.AWS_INSTANCE_TYPE || "t3a.small",
    awsSecurityGroupId: source.AWS_SECURITY_GROUP_ID || "",
    awsSubnetId: source.AWS_SUBNET_ID || "",
    awsAmiSsmPath:
      source.AWS_AMI_SSM_PATH ||
      "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id",

    unitPriceFen: Number(source.UNIT_PRICE_FEN || 100),

    alipayAppId: source.ALIPAY_APP_ID || "",
    alipayPrivateKey: (source.ALIPAY_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    alipayPublicKey: (source.ALIPAY_PUBLIC_KEY || "").replace(/\\n/g, "\n"),
    alipayNotifyUrl: source.ALIPAY_NOTIFY_URL || "",

    wechatPayMchid: source.WECHAT_PAY_MCHID || "",
    wechatPaySerial: source.WECHAT_PAY_SERIAL || "",
    wechatPayPrivateKey: (source.WECHAT_PAY_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    wechatPayPubkeyId: source.WECHAT_PAY_PUBKEY_ID || "",
    wechatPayPubkey: (source.WECHAT_PAY_PUBKEY || "").replace(/\\n/g, "\n"),
    wechatPayApiV3Key: source.WECHAT_PAY_API_V3_KEY || "",
    wechatPayAppId: source.WECHAT_PAY_APP_ID || "",
    wechatPayNotifyUrl: source.WECHAT_PAY_NOTIFY_URL || "",

    emailUser: source.EMAIL || "",
    emailToken: source.EMAIL_TOKEN || "",
  };
}

module.exports = {
  getEnv,
  PROJECT_ROOT,
};
