import type { Server } from 'node:http';

import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
} from '@playwright/test';

import { startHealthcheckServer } from '../../src/mock/server';
import { createValidHealthcheckPayload } from '../../test-data/healthcheck-payload';

type ValidationError = {
  instancePath: string;
  keyword: string;
  params: Record<string, unknown>;
  message?: string;
};

type ErrorResponse = {
  status: 'error';
  errors: ValidationError[];
};

let server: Server;
let healthcheckUrl: string;

async function postHealthcheck(
  request: APIRequestContext,
  payload: unknown,
): Promise<APIResponse> {
  return request.post(healthcheckUrl, { data: payload });
}

async function expectJsonBody(
  response: APIResponse,
  expectedStatus: 200 | 400,
): Promise<unknown> {
  expect(response.status()).toBe(expectedStatus);
  expect(response.headers()['content-type']).toMatch(/^application\/json(?:;|$)/i);
  return response.json();
}

async function expectValidationError(
  response: APIResponse,
  expectedError: Partial<ValidationError>,
): Promise<void> {
  const body = (await expectJsonBody(response, 400)) as ErrorResponse;

  expect(body.status).toBe('error');
  expect(Array.isArray(body.errors)).toBe(true);
  expect(body.errors.length).toBeGreaterThan(0);
  expect(
    body.errors.every(
      (error) => typeof error.message === 'string' && error.message.length > 0,
    ),
  ).toBe(true);
  expect(body.errors).toEqual(
    expect.arrayContaining([expect.objectContaining(expectedError)]),
  );
}

function withoutRootField(field: string): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    ...createValidHealthcheckPayload(),
  };
  delete payload[field];
  return payload;
}

test.describe('Task 3 - Agent healthcheck validation', () => {
  test.beforeAll(async () => {
    server = await startHealthcheckServer({ port: 0, silent: true });
    const address = server.address();

    if (!address || typeof address === 'string') {
      throw new Error('Healthcheck mock did not expose a TCP port.');
    }

    healthcheckUrl = `http://127.0.0.1:${address.port}/api/v1/healthcheck`;
  });

  test.afterAll(async () => {
    await new Promise<void>((resolveServer, rejectServer) => {
      server.close((error) => {
        if (error) {
          rejectServer(error);
          return;
        }

        resolveServer();
      });
    });
  });

  // Why: A complete healthcheck is the server's basic proof that an enrolled agent
  // can report enough host identity and state for monitoring without schema drift.
  test('accepts a complete valid healthcheck payload', async ({ request }) => {
    const response = await postHealthcheck(request, createValidHealthcheckPayload());
    const body = await expectJsonBody(response, 200);

    expect(body).toEqual({ status: 'ok' });
  });

  // Why: Hosts commonly expose several interfaces. Accepting IPv4, IPv6, and a
  // Windows zone-indexed link-local IPv6 address prevents valid network inventory
  // from being discarded or silently reduced to one adapter.
  test('accepts multiple adapters including an IPv6 zone index', async ({ request }) => {
    const payload = createValidHealthcheckPayload({
      adapter_info: [
        {
          addresses: ['fe80::8c04:b189:43dc:c8de%7', '192.168.195.150'],
          name: 'Ethernet (Kernel Debugger)',
        },
        {
          addresses: ['::1', '127.0.0.1'],
          name: 'Loopback Pseudo-Interface 1',
        },
      ],
    });

    const response = await postHealthcheck(request, payload);
    const body = await expectJsonBody(response, 200);

    expect(body).toEqual({ status: 'ok' });
  });

  // Why: Concurrent Active and Disconnected sessions are normal on managed hosts;
  // preserving both states is necessary for reliable operator and access telemetry.
  test('accepts multiple sessions with Active and Disconnected states', async ({
    request,
  }) => {
    const payload = createValidHealthcheckPayload({
      session_info: [
        {
          account_name: '',
          account_sid: '',
          host_name: '',
          session_id: 0,
          session_name: 'Services',
          state: 'Disconnected',
        },
        {
          account_name: 'VM11\\User',
          account_sid: 'S-1-5-21-2847140545-887463911-2297178777-1001',
          host_name: '',
          session_id: 1,
          session_name: 'Console',
          state: 'Active',
        },
      ],
    });

    const response = await postHealthcheck(request, payload);
    const body = await expectJsonBody(response, 200);

    expect(body).toEqual({ status: 'ok' });
  });

  // Why: Without agent_id, the backend cannot associate a heartbeat with the
  // enrolled endpoint, so accepting it could corrupt device liveness records.
  test('rejects a payload missing agent_id', async ({ request }) => {
    const response = await postHealthcheck(request, withoutRootField('agent_id'));

    await expectValidationError(response, {
      instancePath: '',
      keyword: 'required',
      params: { missingProperty: 'agent_id' },
    });
  });

  // Why: computer_name is the operator-facing host identity; accepting its absence
  // would leave alerts and inventory entries ambiguous during incident response.
  test('rejects a payload missing computer_name', async ({ request }) => {
    const response = await postHealthcheck(request, withoutRootField('computer_name'));

    await expectValidationError(response, {
      instancePath: '',
      keyword: 'required',
      params: { missingProperty: 'computer_name' },
    });
  });

  // Why: os_build is needed to compare the endpoint with vulnerable or supported
  // OS builds; a missing value would weaken patch and exposure assessment.
  test('rejects a payload missing os_build', async ({ request }) => {
    const response = await postHealthcheck(request, withoutRootField('os_build'));

    await expectValidationError(response, {
      instancePath: '',
      keyword: 'required',
      params: { missingProperty: 'os_build' },
    });
  });

  // Why: Treating an OS version number as text can break numeric comparisons used
  // for patch baselines and may let malformed agent data enter downstream rules.
  test('rejects os_major sent as a string', async ({ request }) => {
    const payload = {
      ...createValidHealthcheckPayload(),
      os_major: '10',
    };

    const response = await postHealthcheck(request, payload);

    await expectValidationError(response, {
      instancePath: '/os_major',
      keyword: 'type',
    });
  });

  // Why: agent_id is an authority-bearing identifier. Enforcing its UUID shape
  // prevents arbitrary labels from colliding with or bypassing managed-agent lookup.
  test('rejects a malformed agent_id UUID', async ({ request }) => {
    const payload = createValidHealthcheckPayload({
      agent_id: 'not-a-valid-uuid',
    });

    const response = await postHealthcheck(request, payload);

    await expectValidationError(response, {
      instancePath: '/agent_id',
      keyword: 'format',
    });
  });

  // Why: Boot time must use one unambiguous UTC clock. Accepting an offset instead
  // of the required Z suffix could make reboot and persistence timelines inconsistent.
  test('rejects last_boot_time without the required UTC Z suffix', async ({ request }) => {
    const payload = createValidHealthcheckPayload({
      last_boot_time: '2022-07-16T22:53:27+02:00',
    });

    const response = await postHealthcheck(request, payload);

    await expectValidationError(response, {
      instancePath: '/last_boot_time',
      keyword: 'pattern',
    });
  });

  // Why: An agent reporting no adapters gives the backend no network identity to
  // correlate with endpoint exposure, reachability, or suspicious address changes.
  test('rejects an empty adapter_info array', async ({ request }) => {
    const payload = createValidHealthcheckPayload({ adapter_info: [] });

    const response = await postHealthcheck(request, payload);

    await expectValidationError(response, {
      instancePath: '/adapter_info',
      keyword: 'minItems',
    });
  });

  // Why: Addresses without an adapter name cannot be mapped to the interface that
  // produced them, which makes network-change evidence ambiguous for operators.
  test('rejects an adapter missing its name', async ({ request }) => {
    const adapterWithoutName: Record<string, unknown> = {
      addresses: ['192.168.195.150'],
    };
    const payload = {
      ...createValidHealthcheckPayload(),
      adapter_info: [adapterWithoutName],
    };

    const response = await postHealthcheck(request, payload);

    await expectValidationError(response, {
      instancePath: '/adapter_info/0',
      keyword: 'required',
      params: { missingProperty: 'name' },
    });
  });

  // Why: Invalid addresses poison host inventory and can defeat correlation rules
  // that assume every reported value is a real IPv4 or IPv6 endpoint.
  test('rejects an invalid adapter IP address', async ({ request }) => {
    const payload = createValidHealthcheckPayload({
      adapter_info: [
        {
          addresses: ['999.999.999.999'],
          name: 'Ethernet',
        },
      ],
    });

    const response = await postHealthcheck(request, payload);

    await expectValidationError(response, {
      instancePath: '/adapter_info/0/addresses/0',
      keyword: 'format',
    });
  });

  // Why: Unknown root fields can smuggle unsupported agent data into a security
  // boundary and hide client/server version drift, so the root contract is closed.
  test('rejects an extra root-level field', async ({ request }) => {
    const payload = {
      ...createValidHealthcheckPayload(),
      untrusted_extension: true,
    };

    const response = await postHealthcheck(request, payload);

    await expectValidationError(response, {
      instancePath: '',
      keyword: 'additionalProperties',
      params: { additionalProperty: 'untrusted_extension' },
    });
  });

  // Why: Roles drive how the backend classifies and protects an endpoint. An
  // unsupported role could route a workstation through the wrong security policy.
  test('rejects an unsupported agent role', async ({ request }) => {
    const payload = {
      ...createValidHealthcheckPayload(),
      roles: ['administrator'],
    };

    const response = await postHealthcheck(request, payload);

    await expectValidationError(response, {
      instancePath: '/roles/0',
      keyword: 'enum',
    });
  });

  // Why: Session state feeds access and anomaly analysis. Unbounded state labels
  // could make active access disappear from rules expecting the defined vocabulary.
  test('rejects an unsupported session state', async ({ request }) => {
    const validSession = createValidHealthcheckPayload().session_info[0];
    const payload = {
      ...createValidHealthcheckPayload(),
      session_info: [{ ...validSession, state: 'Sleeping' }],
    };

    const response = await postHealthcheck(request, payload);

    await expectValidationError(response, {
      instancePath: '/session_info/0/state',
      keyword: 'enum',
    });
  });

  // Why: Negative session identifiers are impossible in the source system and can
  // break correlation between agent telemetry and the operating-system session.
  test('rejects a negative session_id', async ({ request }) => {
    const validSession = createValidHealthcheckPayload().session_info[0];
    const payload = {
      ...createValidHealthcheckPayload(),
      session_info: [{ ...validSession, session_id: -1 }],
    };

    const response = await postHealthcheck(request, payload);

    await expectValidationError(response, {
      instancePath: '/session_info/0/session_id',
      keyword: 'minimum',
    });
  });

  // Why: An empty computer name is technically a string but carries no identity;
  // rejecting it prevents blank endpoints from becoming indistinguishable in alerts.
  test('rejects an empty required computer_name', async ({ request }) => {
    const payload = createValidHealthcheckPayload({ computer_name: '' });

    const response = await postHealthcheck(request, payload);

    await expectValidationError(response, {
      instancePath: '/computer_name',
      keyword: 'minLength',
    });
  });

  // Why: account_sid is required even when empty because omitting the key signals
  // a structurally incomplete agent message, not merely unavailable OS information.
  test('rejects a session missing account_sid', async ({ request }) => {
    const session: Record<string, unknown> = {
      ...createValidHealthcheckPayload().session_info[0],
    };
    delete session.account_sid;
    const payload = {
      ...createValidHealthcheckPayload(),
      session_info: [session],
    };

    const response = await postHealthcheck(request, payload);

    await expectValidationError(response, {
      instancePath: '/session_info/0',
      keyword: 'required',
      params: { missingProperty: 'account_sid' },
    });
  });
});
