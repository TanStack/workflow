---
id: HandleWebhookOptions
title: HandleWebhookOptions
---

# Interface: HandleWebhookOptions

Defined in: [packages/workflow-core/src/engine/handle-webhook.ts:19](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/handle-webhook.ts#L19)

## Properties

### payload

```ts
payload: WebhookPayload;
```

Defined in: [packages/workflow-core/src/engine/handle-webhook.ts:24](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/handle-webhook.ts#L24)

Parsed webhook payload (typically built from the HTTP request
 body via `parseWorkflowRequest`).

***

### publish()?

```ts
optional publish: (runId, event) => void | Promise<void>;
```

Defined in: [packages/workflow-core/src/engine/handle-webhook.ts:27](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/handle-webhook.ts#L27)

Hook called for every event the engine appends, before the
 webhook handler returns.

#### Parameters

##### runId

`string`

##### event

[`WorkflowEvent`](../type-aliases/WorkflowEvent.md)

#### Returns

`void` \| `Promise`\<`void`\>

***

### runStore

```ts
runStore: RunStore;
```

Defined in: [packages/workflow-core/src/engine/handle-webhook.ts:21](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/handle-webhook.ts#L21)

***

### workflow

```ts
workflow: AnyWorkflowDefinition;
```

Defined in: [packages/workflow-core/src/engine/handle-webhook.ts:20](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/handle-webhook.ts#L20)
