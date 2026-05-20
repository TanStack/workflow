import { useEffect } from 'react'
import { useSelector } from '@tanstack/react-store'
import type { Template } from '@tanstack/template'

export function useTemplate(template: Template) {
  console.log('Hello from @tanstack/react-template!')
  const state = useSelector(template.store)

  useEffect(() => {
    console.log('Template hook mounted')
  }, [])

  return state
}
