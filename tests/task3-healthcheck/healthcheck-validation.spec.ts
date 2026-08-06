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

  // Sends a complete valid healthcheck payload.
  // Checks that the server accepts it and returns status ok.
  test('accepts a complete valid healthcheck payload', async ({ request }) => {
    const response = await postHealthcheck(request, createValidHealthcheckPayload());
    const body = await expectJsonBody(response, 200);

    expect(body).toEqual({ status: 'ok' });
  });

  // Sends several network adapters with IPv4, IPv6 and a zone-indexed IPv6 address.
  // Checks that all supported address formats are accepted.
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

  // Sends multiple sessions with Active and Disconnected states.
  // Checks that both supported session states are accepted.
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

  // Removes agent_id from the payload.
  // Checks that the server rejects the missing required field.
  test('rejects a payload missing agent_id', async ({ request }) => {
    const response = await postHealthcheck(request, withoutRootField('agent_id'));

    await expectValidationError(response, {
      instancePath: '',
      keyword: 'required',
      params: { missingProperty: 'agent_id' },
    });
  });

  // Removes computer_name from the payload.
  // Checks that the server rejects the missing required field.
  test('rejects a payload missing computer_name', async ({ request }) => {
    const response = await postHealthcheck(request, withoutRootField('computer_name'));

    await expectValidationError(response, {
      instancePath: '',
      keyword: 'required',
      params: { missingProperty: 'computer_name' },
    });
  });

  // Removes os_build from the payload.
  // Checks that the server rejects the missing required field.
  test('rejects a payload missing os_build', async ({ request }) => {
    const response = await postHealthcheck(request, withoutRootField('os_build'));

    await expectValidationError(response, {
      instancePath: '',
      keyword: 'required',
      params: { missingProperty: 'os_build' },
    });
  });

  // Sends os_major as text instead of an integer.
  // Checks that the server rejects the wrong data type.
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

  // Sends an invalid agent_id value.
  // Checks that the server rejects a malformed UUID.
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

  // Sends agent_id with a urn:uuid prefix.
  // Checks that only the required bare UUID format is accepted.
  test('rejects a URN-prefixed agent_id UUID', async ({ request }) => {
    const payload = createValidHealthcheckPayload({
      agent_id: 'urn:uuid:BF5D99A1-624D-4B6D-8B1B-5D66B23D12D7',
    });

    const response = await postHealthcheck(request, payload);

    await expectValidationError(response, {
      instancePath: '/agent_id',
      keyword: 'pattern',
    });
  });

  // Sends system_product_uuid with a urn:uuid prefix.
  // Checks that only the required bare UUID format is accepted.
  test('rejects a URN-prefixed system_product_uuid', async ({ request }) => {
    const payload = createValidHealthcheckPayload({
      system_product_uuid:
        'urn:uuid:4A114D56-62E0-8B0B-594A-6618D15F8385',
    });

    const response = await postHealthcheck(request, payload);

    await expectValidationError(response, {
      instancePath: '/system_product_uuid',
      keyword: 'pattern',
    });
  });

  // Sends last_boot_time with a time-zone offset instead of the required Z suffix.
  // Checks that the server rejects the timestamp format.
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

  // Sends an empty adapter_info array.
  // Checks that at least one network adapter is required.
  test('rejects an empty adapter_info array', async ({ request }) => {
    const payload = createValidHealthcheckPayload({ adapter_info: [] });

    const response = await postHealthcheck(request, payload);

    await expectValidationError(response, {
      instancePath: '/adapter_info',
      keyword: 'minItems',
    });
  });

  // Sends an adapter without its name.
  // Checks that the missing required adapter field is rejected.
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

  // Sends an invalid IP address in adapter_info.
  // Checks that the server rejects the invalid address format.
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

  // Adds an unsupported field to the root payload.
  // Checks that extra root-level fields are rejected.
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

  // Sends an unsupported agent role.
  // Checks that only the allowed role values are accepted.
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

  // Sends an unsupported session state.
  // Checks that only Active and Disconnected are accepted.
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

  // Sends a negative session_id.
  // Checks that session IDs must be zero or greater.
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

  // Sends an empty computer_name value.
  // Checks that the required name cannot be an empty string.
  test('rejects an empty required computer_name', async ({ request }) => {
    const payload = createValidHealthcheckPayload({ computer_name: '' });

    const response = await postHealthcheck(request, payload);

    await expectValidationError(response, {
      instancePath: '/computer_name',
      keyword: 'minLength',
    });
  });

  // Removes account_sid from a session.
  // Checks that the required session field must still be present.
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

  // Sends a JSON number instead of a healthcheck object.
  // Checks that the server returns the normal JSON validation error response.
  test('rejects a JSON primitive through the validation error contract', async ({
    request,
  }) => {
    const response = await request.post(healthcheckUrl, {
      headers: { 'Content-Type': 'application/json' },
      data: '123',
    });

    await expectValidationError(response, {
      instancePath: '',
      keyword: 'type',
    });
  });

  // Sends malformed JSON syntax.
  // Checks that the server returns a controlled JSON parse error.
  test('returns a controlled JSON error for malformed JSON syntax', async ({
    request,
  }) => {
    const response = await request.post(healthcheckUrl, {
      headers: { 'Content-Type': 'application/json' },
      data: Buffer.from('{"agent_id":'),
    });

    await expectValidationError(response, {
      instancePath: '',
      keyword: 'parse',
      message: 'must contain valid JSON',
    });
  });
});
