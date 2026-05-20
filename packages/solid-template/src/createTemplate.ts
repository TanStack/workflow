import { onMount } from 'solid-js'
import { useSelector } from '@tanstack/solid-store'
import type { Template } from '@tanstack/template'

export function createTemplateSignal(template: Template) {
  console.log('Hello from @tanstack/solid-template!')
  const state = useSelector(template.store)

  onMount(() => {
    console.log('Template signal mounted')
  })

  return state
}
