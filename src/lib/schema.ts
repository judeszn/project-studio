export interface Measurement {
  quantity: string
  value: number
  unit: string
}

export interface ExperimentRecord {
  experiment_title: string
  materials: string[]
  observations: string[]
  measurements: Measurement[]
  results: string
  missing_information: string[]
}

// Plain JSON Schema: passed to Gemini Nano as `responseConstraint`, and the
// shape `parseRecord` in verify.ts re-checks by hand. Keep the two in step.
export const experimentRecordSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'experiment_title',
    'materials',
    'observations',
    'measurements',
    'results',
    'missing_information',
  ],
  properties: {
    experiment_title: { type: 'string' },
    materials: { type: 'array', items: { type: 'string' } },
    observations: { type: 'array', items: { type: 'string' } },
    measurements: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['quantity', 'value', 'unit'],
        properties: {
          quantity: { type: 'string' },
          value: { type: 'number' },
          unit: { type: 'string' },
        },
      },
    },
    results: { type: 'string' },
    missing_information: { type: 'array', items: { type: 'string' } },
  },
} as const
