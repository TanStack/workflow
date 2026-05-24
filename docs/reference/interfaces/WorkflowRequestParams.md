---
id: WorkflowRequestParams
title: WorkflowRequestParams
---

# Interface: WorkflowRequestParams

Defined in: [packages/workflow-core/src/server/parse-request.ts:3](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/server/parse-request.ts#L3)

## Properties

### abort?

```ts
optional abort: boolean;
```

Defined in: [packages/workflow-core/src/server/parse-request.ts:11](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/server/parse-request.ts#L11)

`true` when the client wants to cancel an in-flight run.

***

### approval?

```ts
optional approval: ApprovalResult;
```

Defined in: [packages/workflow-core/src/server/parse-request.ts:4](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/server/parse-request.ts#L4)

***

### input?

```ts
optional input: unknown;
```

Defined in: [packages/workflow-core/src/server/parse-request.ts:8](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/server/parse-request.ts#L8)

***

### runId?

```ts
optional runId: string;
```

Defined in: [packages/workflow-core/src/server/parse-request.ts:9](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/server/parse-request.ts#L9)

***

### signalDelivery?

```ts
optional signalDelivery: SignalDelivery<unknown>;
```

Defined in: [packages/workflow-core/src/server/parse-request.ts:7](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/server/parse-request.ts#L7)

Generic signal delivery. Mutually exclusive with `approval` in
 practice; `signalDelivery` takes precedence if both are set.
