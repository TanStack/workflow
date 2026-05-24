---
id: WebhookPayload
title: WebhookPayload
---

# Interface: WebhookPayload

Defined in: [packages/workflow-core/src/engine/handle-webhook.ts:9](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/handle-webhook.ts#L9)

## Properties

### approval?

```ts
optional approval: object;
```

Defined in: [packages/workflow-core/src/engine/handle-webhook.ts:12](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/handle-webhook.ts#L12)

#### approvalId

```ts
approvalId: string;
```

#### approved

```ts
approved: boolean;
```

#### feedback?

```ts
optional feedback: string;
```

***

### runId

```ts
runId: string;
```

Defined in: [packages/workflow-core/src/engine/handle-webhook.ts:10](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/handle-webhook.ts#L10)

***

### signalDelivery?

```ts
optional signalDelivery: SignalDelivery<unknown>;
```

Defined in: [packages/workflow-core/src/engine/handle-webhook.ts:11](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/handle-webhook.ts#L11)
