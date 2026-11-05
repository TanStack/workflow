---
id: AssertNonReservedExtension
title: AssertNonReservedExtension
---

# Type Alias: AssertNonReservedExtension\<TExt\>

```ts
type AssertNonReservedExtension<TExt> = keyof TExt & ReservedCtxFields extends never ? TExt : `Middleware extension may not shadow reserved ctx field: ${keyof TExt & ReservedCtxFields & string}`;
```

Defined in: [packages/workflow-core/src/types.ts:348](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L348)

Compile-time guard for middleware extensions. Resolves to `TExt`
 when no reserved ctx field is shadowed; otherwise resolves to a
 readable string literal error.

## Type Parameters

### TExt

`TExt`
