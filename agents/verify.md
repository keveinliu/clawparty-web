# Cleanup Agent

> This file keeps its legacy path (`agents/verify.md`) for compatibility, but the documented behavior is cleanup.

## Overview

The Cleanup Agent releases provisioned AWS resources after the purchased usage window.

## Trigger

- Job type: `cleanup`
- Depends on: linked provision job completed
- Delay rule: `delayHours = order.quantity`
- Execute when: `scheduledTime <= now`

## Workflow

1. Load cleanup job and order resource metadata.
2. Stop EC2 instance (`ec2InstanceId`).
3. Delete Route53 A record tied to the order.
4. Update order (`cleanedUpAt`, `status=complete`).
5. Mark cleanup job as completed.

## Job Payload Example

```json
{
  "id": "job-uuid",
  "orderId": "order-uuid",
  "type": "cleanup",
  "afterJobId": "provision-job-uuid",
  "delayHours": 2,
  "scheduledTime": "2026-03-12T17:30:00Z",
  "status": "pending"
}
```

## Error Handling

- Stop/delete partial success must still be retry-safe.
- On unrecoverable failure, mark job and order as `failed` and keep identifiers for manual cleanup.

## Idempotency

Cleanup operations must be safe to rerun:

- Stopping an already stopped instance should be treated as success.
- Deleting an already deleted DNS record should be treated as success.

## Monitoring

Expected log pattern:

```text
Cleanup job def456 completed for order xyz789
```

Track:

- cleanup duration
- cleanup success rate
- residual resource count
