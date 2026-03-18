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

  const grantId = Number(source.YOUZAN_GRANT_ID);

  return {
    port: Number(source.PORT || 3000),
    dataDir: source.DATA_DIR || path.join(PROJECT_ROOT, "data"),
    appBaseUrl: source.APP_BASE_URL || "http://localhost:3000",
    schedulerCron: source.SCHEDULER_CRON || "* * * * *",

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

    youzanCheckoutBaseUrl:
      source.YOUZAN_CHECKOUT_BASE_URL || "https://j.youzan.com/Y4aR8H",
    youzanWebhookSkewSeconds: Number(source.YOUZAN_WEBHOOK_SKEW_SECONDS || 300),
    mockPaymentEnabled: boolFromEnv(source.MOCK_PAYMENT_ENABLED, true),
    youzanAuthorizeType: source.YOUZAN_AUTHORIZE_TYPE || "silent",
    youzanGrantId: Number.isFinite(grantId) ? grantId : null,
    youzanTokenUrl: source.YOUZAN_TOKEN_URL || "https://open.youzanyun.com/auth/token",
    youzanApiBaseUrl: source.YOUZAN_API_BASE_URL || "https://open.youzanyun.com/api",
    youzanUnitPriceFen: Number(source.YOUZAN_UNIT_PRICE_FEN || 100),
    youzanRequestTimeoutMs: Number(source.YOUZAN_REQUEST_TIMEOUT_MS || 10000),

    youzanClientId: source.YOUZAN_CLIENT_ID || "",
    youzanClientSecret: source.YOUZAN_CLIENT_SECRET || "",

    emailUser: source.EMAIL || "",
    emailToken: source.EMAIL_TOKEN || "",
  };
}

module.exports = {
  getEnv,
  PROJECT_ROOT,
};
