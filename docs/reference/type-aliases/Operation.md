---
id: Operation
title: Operation
---

# Type Alias: Operation

```ts
type Operation = 
  | {
  op: "replace";
  path: string;
  value: unknown;
}
  | {
  op: "add";
  path: string;
  value: unknown;
}
  | {
  op: "remove";
  path: string;
};
```

Defined in: [packages/workflow-core/src/engine/state-diff.ts:10](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/state-diff.ts#L10)

Minimal JSON Patch (RFC 6902) helpers for workflow state observability.

Emits the three op kinds the engine needs (replace, add, remove).
Clients applying these patches handle the same set. Move/copy/test
are intentionally omitted — they're never produced by a forward diff
and the spec allows producers to use any subset.
