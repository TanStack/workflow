---
id: WorkflowRequestParseError
title: WorkflowRequestParseError
---

# Class: WorkflowRequestParseError

Defined in: [packages/workflow-core/src/server/parse-request.ts:76](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/server/parse-request.ts#L76)

Thrown by `parseWorkflowRequest` when the body cannot be parsed or
is not a JSON object. Route handlers should catch and return a 400.

## Extends

- `Error`

## Constructors

### Constructor

```ts
new WorkflowRequestParseError(message, cause?): WorkflowRequestParseError;
```

Defined in: [packages/workflow-core/src/server/parse-request.ts:78](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/server/parse-request.ts#L78)

#### Parameters

##### message

`string`

##### cause?

`unknown`

#### Returns

`WorkflowRequestParseError`

#### Overrides

```ts
Error.constructor
```

## Properties

### cause?

```ts
readonly optional cause: unknown;
```

Defined in: [packages/workflow-core/src/server/parse-request.ts:80](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/server/parse-request.ts#L80)

#### Inherited from

```ts
Error.cause
```

***

### message

```ts
message: string;
```

Defined in: node\_modules/.pnpm/typescript@6.0.3/node\_modules/typescript/lib/lib.es5.d.ts:1075

#### Inherited from

```ts
Error.message
```

***

### name

```ts
readonly name: "WorkflowRequestParseError" = 'WorkflowRequestParseError';
```

Defined in: [packages/workflow-core/src/server/parse-request.ts:77](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/server/parse-request.ts#L77)

#### Overrides

```ts
Error.name
```

***

### stack?

```ts
optional stack: string;
```

Defined in: node\_modules/.pnpm/typescript@6.0.3/node\_modules/typescript/lib/lib.es5.d.ts:1076

#### Inherited from

```ts
Error.stack
```
