---
id: handleWorkflowWebhook
title: handleWorkflowWebhook
---

# Function: handleWorkflowWebhook()

```ts
function handleWorkflowWebhook(options): Promise<readonly WorkflowEvent[]>;
```

Defined in: [packages/workflow-core/src/engine/handle-webhook.ts:44](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/handle-webhook.ts#L44)

Drive one webhook-triggered invocation of a workflow to its next
pause point (or completion).

Intended for Durable-Streams-style execution where the workflow
lives as a stateless HTTP handler that the streams server POSTs to
when external events arrive. Reads the run's history from the
`runStore`, replays user code, advances past the seed delivery,
pauses at the next awaitable, returns.

Returns the list of events appended during this invocation —
useful for the caller to forward as the HTTP response body if the
streams server wants confirmation of the new state.

## Parameters

### options

[`HandleWebhookOptions`](../interfaces/HandleWebhookOptions.md)

## Returns

`Promise`\<readonly [`WorkflowEvent`](../type-aliases/WorkflowEvent.md)[]\>
