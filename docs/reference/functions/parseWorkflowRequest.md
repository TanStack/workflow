---
id: parseWorkflowRequest
title: parseWorkflowRequest
---

# Function: parseWorkflowRequest()

```ts
function parseWorkflowRequest(request): Promise<WorkflowRequestParams>;
```

Defined in: [packages/workflow-core/src/server/parse-request.ts:39](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/server/parse-request.ts#L39)

Parse a workflow run request body. Returns params to spread into
`runWorkflow(...)`.

## Parameters

### request

`Request`

## Returns

`Promise`\<[`WorkflowRequestParams`](../interfaces/WorkflowRequestParams.md)\>

## Example

```typescript
POST: async ({ request }) => {
  const params = await parseWorkflowRequest(request)
  if (params.abort && params.runId) {
    // ...host-specific abort plumbing
    return new Response(null, { status: 204 })
  }
  const stream = runWorkflow({ workflow, runStore, ...params })
  return toServerSentEventsResponse(stream)
}
```
