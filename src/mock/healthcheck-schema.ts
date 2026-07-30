import type { JSONSchemaType } from 'ajv';

export type AgentRole = 'workstation' | 'server' | 'domain_controller';
export type SessionState = 'Active' | 'Disconnected';

export type AdapterInfo = {
  name: string;
  addresses: string[];
};

export type SessionInfo = {
  account_name: string;
  account_sid: string;
  host_name: string;
  session_id: number;
  session_name: string;
  state: SessionState;
};

export type HealthcheckPayload = {
  agent_id: string;
  base_board_sn: string;
  computer_name: string;
  system_product_uuid: string;
  os_name: string;
  os_major: number;
  os_minor: number;
  os_build: number;
  last_boot_time: string;
  last_update_time: string;
  adapter_info: AdapterInfo[];
  session_info: SessionInfo[];
  roles: AgentRole[];
};

const utcTimestampSchema = {
  type: 'string',
  format: 'date-time',
  pattern: 'Z$',
} as const;

export const healthcheckSchema: JSONSchemaType<HealthcheckPayload> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'agent_id',
    'base_board_sn',
    'computer_name',
    'system_product_uuid',
    'os_name',
    'os_major',
    'os_minor',
    'os_build',
    'last_boot_time',
    'last_update_time',
    'adapter_info',
    'session_info',
    'roles',
  ],
  properties: {
    agent_id: {
      type: 'string',
      format: 'uuid',
    },
    base_board_sn: {
      type: 'string',
    },
    computer_name: {
      type: 'string',
      minLength: 1,
    },
    system_product_uuid: {
      type: 'string',
      format: 'uuid',
    },
    os_name: {
      type: 'string',
      minLength: 1,
    },
    os_major: {
      type: 'integer',
      minimum: 0,
    },
    os_minor: {
      type: 'integer',
      minimum: 0,
    },
    os_build: {
      type: 'integer',
      minimum: 0,
    },
    last_boot_time: utcTimestampSchema,
    last_update_time: utcTimestampSchema,
    adapter_info: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['name', 'addresses'],
        properties: {
          name: {
            type: 'string',
            minLength: 1,
          },
          addresses: {
            type: 'array',
            items: {
              type: 'string',
              format: 'ip-address',
            },
          },
        },
      },
    },
    session_info: {
      type: 'array',
      items: {
        type: 'object',
        required: [
          'account_name',
          'account_sid',
          'host_name',
          'session_id',
          'session_name',
          'state',
        ],
        properties: {
          account_name: {
            type: 'string',
          },
          account_sid: {
            type: 'string',
          },
          host_name: {
            type: 'string',
          },
          session_id: {
            type: 'integer',
            minimum: 0,
          },
          session_name: {
            type: 'string',
            minLength: 1,
          },
          state: {
            type: 'string',
            enum: ['Active', 'Disconnected'],
          },
        },
      },
    },
    roles: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'string',
        enum: ['workstation', 'server', 'domain_controller'],
      },
    },
  },
};
