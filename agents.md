# Agents Documentation

## Overview

Clawparty uses autonomous agents to run provisioning and delayed cleanup workflows.

## Agent Types

### 1. Provision Agent

**Responsibility:** Create EC2 instance and Route53 A record.

**Trigger:** Scheduled at order `deliveryTime`.

**Workflow:**

1. Resolve latest Ubuntu 24.04 AMI.
2. Create EC2 instance with order tags.
3. Capture public IP.
4. Create Route53 A record.
5. Update order with `ec2InstanceId` and `dnsRecordId`.
6. Mark provision job completed.

### 2. Cleanup Agent

**Responsibility:** Stop EC2 instance and delete DNS record.

**Trigger:** `N` hours after provision succeeds, where `N = order.quantity`.

**Workflow:**

1. Read order and linked provision result.
2. Stop the order EC2 instance.
3. Delete corresponding Route53 A record.
4. Mark order as `complete`.
5. Mark cleanup job completed.

## Job Scheduling

Jobs are persisted in `data/jobs.json` and processed by scheduler (`SCHEDULER_CRON`).

### Job Types

**Provision Job**

```json
{
  "id": "uuid",
  "orderId": "uuid",
  "type": "provision",
  "scheduledTime": "2026-03-12T15:30:00Z",
  "status": "pending|completed|failed"
}
```

**Cleanup Job**

```json
{
  "id": "uuid",
  "orderId": "uuid",
  "type": "cleanup",
  "afterJobId": "provision-job-id",
  "delayHours": 2,
  "scheduledTime": "2026-03-12T17:30:00Z",
  "status": "pending|completed|failed"
}
```

## Idempotency

- **Provision Agent:** safe retry, must avoid duplicate instance creation.
- **Cleanup Agent:** safe retry, stop/delete operations must tolerate partial prior success.

## Configuration

```bash
AWS_ENABLED=false
AWS_REGION=us-east-1
AWS_HOSTED_ZONE_ID=Z1234567890ABC
AWS_DOMAIN_SUFFIX=clawparty.ai
AWS_INSTANCE_TYPE=t3a.small
AWS_SECURITY_GROUP_ID=sg-xxx
AWS_SUBNET_ID=subnet-xxx
AWS_AMI_SSM_PATH=/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id

SCHEDULER_CRON="* * * * *"
```

Cleanup delay source:

- `cleanupDelayHours = order.quantity`

## Logs

```text
Provision job abc123 completed for order xyz789
Cleanup job def456 completed for order xyz789
```

## Failure Scenarios

- Provision failure: order -> `failed`, cleanup is not executed.
- Cleanup failure: order -> `failed`, residual resources may require retry/manual cleanup.
