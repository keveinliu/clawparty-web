# Architecture Specification

## System Overview

Clawparty is a Node.js subscription platform that provisions AWS resources after payment and then cleans them up automatically.

Core lifecycle:

1. **Provision Job**: runs at `deliveryTime` to create an EC2 instance and Route53 A record.
2. **Cleanup Job**: runs after provision succeeds, delayed by `N` hours where `N = order.quantity`, to stop EC2 and delete DNS.

```text
Browser -> Express App -> Orders/Jobs Store -> Scheduler -> AWS Services
```

## Components

### 1. Web Layer (`views/`)

- `index.ejs`: landing page with subscription entry.
- `checkout.ejs`: order form (`quantity`, `deliveryTime`, `phone`).
- `success.ejs`: confirmation page.
- `error.ejs`: error page.

### 2. Express App (`src/app.js`)

- Serves static assets and templates.
- Mounts webhook routes before generic JSON body parsing for signature verification safety.
- Exposes order/payment APIs and webhook handlers.

### 3. API Routes (`src/routes/api.js`)

- `POST /orders`
- `GET /orders/:id`
- `GET /orders`
- `POST /orders/:id/payment-session`
- `POST /orders/:id/payment-success`

Payment success schedules two jobs: `provision` and `cleanup`.

### 4. Webhook Routes (`src/routes/webhooks.js`)

- `POST /webhooks/youzan/payment-callback`
- `POST /webhooks/mock/payment-success`

Both routes schedule the same two-job lifecycle.

### 5. Order Model (`src/models/order.js`)

Order storage is persisted in `data/orders.json`.

Target order contract:

```javascript
{
  id: uuid,
  status: ORDER_STATUS,
  quantity: number,
  deliveryTime: ISO8601,
  phone: string,
  createdAt: ISO8601,
  updatedAt: ISO8601,
  paymentSessionId: uuid | null,
  provisionJobId: uuid | null,
  cleanupJobId: uuid | null,
  ec2InstanceId: string | null,
  dnsRecordId: string | null,
  provisionedAt: ISO8601 | null,
  cleanupScheduledTime: ISO8601 | null,
  cleanedUpAt: ISO8601 | null,
  idempotencyKey: string | null
}
```

### 6. Scheduler (`src/scheduler.js`)

- Cron-driven polling (`SCHEDULER_CRON`, default every minute).
- Persistent queue in `data/jobs.json`.
- Job types: `provision` and `cleanup`.
- Cleanup delay rule: `cleanupDelayHours = order.quantity`.

Job flow:

1. Payment success creates provision job (scheduled at `deliveryTime`).
2. Provision job completes and writes instance/DNS metadata.
3. Cleanup job is scheduled for `provisionCompletedAt + quantity * 1h`.
4. Cleanup job stops EC2 and deletes Route53 record.

### 7. AWS Service Layer (`src/services/awsProvisioning.js`)

Current/target methods:

- `getLatestUbuntuAmi()`
- `provisionInstance(orderId)`
- `createDnsRecord(orderId, instanceIp)`
- `stopInstance(instanceId)`
- `deleteDnsRecord(recordNameOrId)`

### 8. Youzan Verification (`src/services/youzanVerification.js`)

- HMAC-SHA256 signature verification.
- Timestamp skew protection.
- Raw payload verification support.

## Data Storage

### `jobs.json`

```json
[
  {
    "id": "uuid",
    "orderId": "uuid",
    "type": "provision",
    "scheduledTime": "2026-03-12T15:30:00Z",
    "status": "pending|completed|failed",
    "result": {
      "instanceId": "i-xxx",
      "dnsName": "abc123.clawparty.ai"
    }
  },
  {
    "id": "uuid",
    "orderId": "uuid",
    "type": "cleanup",
    "afterJobId": "provision-job-id",
    "delayHours": 2,
    "scheduledTime": "2026-03-12T17:30:00Z",
    "status": "pending|completed|failed",
    "result": {
      "instanceStopped": true,
      "dnsDeleted": true
    }
  }
]
```

## Configuration

```bash
PORT=3000
DATA_DIR=./data
SCHEDULER_CRON="* * * * *"

AWS_ENABLED=false
AWS_REGION=us-east-1
AWS_HOSTED_ZONE_ID=
AWS_DOMAIN_SUFFIX=clawparty.ai
AWS_INSTANCE_TYPE=t3a.small
AWS_SECURITY_GROUP_ID=
AWS_SUBNET_ID=
AWS_AMI_SSM_PATH=/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id

YOUZAN_CHECKOUT_BASE_URL=https://j.youzan.com/Y4aR8H
YOUZAN_WEBHOOK_SKEW_SECONDS=300
YOUZAN_CLIENT_ID=
YOUZAN_CLIENT_SECRET=
```

Cleanup delay is derived from `quantity`; no fixed global delay is required.
