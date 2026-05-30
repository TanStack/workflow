import { defineWorkflowRuntime, every } from '@tanstack/workflow-runtime'
import { createCloudflareD1WorkflowStore } from '@tanstack/workflow-store-cloudflare-d1'
import { digestWorkflow, fulfillmentWorkflow } from './workflows'

export interface Env {
  CRON_SECRET?: string
  WORKFLOW_DB: D1Database
}

export function createRuntime(env: Env) {
  const store = createCloudflareD1WorkflowStore({
    db: env.WORKFLOW_DB,
  })

  return defineWorkflowRuntime({
    store,
    workflows: {
      'd1-fulfillment': {
        load: async () => fulfillmentWorkflow,
      },
      'd1-digest': {
        load: async () => digestWorkflow,
        schedules: [
          {
            id: 'd1-digest-every-5m',
            schedule: every.minutes(5),
            overlapPolicy: 'skip',
            input: () => ({
              triggeredAt: Date.now(),
              scheduleId: 'd1-digest-every-5m',
            }),
          },
        ],
      },
    },
  })
}
