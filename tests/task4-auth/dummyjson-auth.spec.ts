import {
  expect,
  request as playwrightRequest,
  test,
  type APIResponse,
} from '@playwright/test';

const BASE_URL = 'https://dummyjson.com';
const LOGIN_URL = `${BASE_URL}/auth/login`;
const CURRENT_USER_URL = `${BASE_URL}/auth/me`;
const USERNAME = 'emilys';
const PASSWORD = 'emilyspass';

type LoginResponse = {
  id: number;
  username: string;
  email: string;
  accessToken: string;
  refreshToken: string;
};

type CurrentUserResponse = {
  id: number;
  username: string;
  email: string;
};

async function expectJsonResponse(
  response: APIResponse,
  expectedStatus: number,
): Promise<unknown> {
  expect(response.status()).toBe(expectedStatus);
  expect(response.headers()['content-type']).toMatch(/^application\/json(?:;|$)/i);
  return response.json();
}

test.describe('Task 4B - DummyJSON API authentication and authorization', () => {
  // Why: Successful authentication must return both short-lived access authority and
  // a refresh credential; a 200 without usable tokens cannot establish a session.
  test('returns non-empty access and refresh tokens for valid credentials', async ({
    request,
  }) => {
    const response = await request.post(LOGIN_URL, {
      data: {
        username: USERNAME,
        password: PASSWORD,
      },
    });
    const body = (await expectJsonResponse(response, 200)) as LoginResponse;

    expect(body).toMatchObject({
      id: 1,
      username: USERNAME,
      email: 'emily.johnson@x.dummyjson.com',
      accessToken: expect.stringMatching(/\S/),
      refreshToken: expect.stringMatching(/\S/),
    });
    expect(body.accessToken).not.toBe(body.refreshToken);
  });

  // Why: Omitting the password must fail at the authentication boundary rather than
  // falling back to username-only access that would bypass possession of a secret.
  test('rejects a login request with a missing password', async ({ request }) => {
    const response = await request.post(LOGIN_URL, {
      data: { username: USERNAME },
    });
    const body = await expectJsonResponse(response, 400);

    expect(body).toEqual({ message: 'Username and password required' });
  });

  // Why: A wrong password must not reveal user data or mint tokens, and callers need
  // a deterministic error response instead of a successful-looking empty object.
  test('rejects invalid credentials without issuing tokens', async ({ request }) => {
    const response = await request.post(LOGIN_URL, {
      data: {
        username: USERNAME,
        password: 'wrong-password',
      },
    });
    const body = await expectJsonResponse(response, 400);

    expect(body).toEqual({ message: 'Invalid credentials' });
    expect(body).not.toHaveProperty('accessToken');
    expect(body).not.toHaveProperty('refreshToken');
  });

  // Why: A bearer token must resolve to the same identity that authenticated.
  // A separate request context proves that /auth/me accepts the header itself and
  // is not succeeding because the login response stored an authentication cookie.
  test('returns the authenticated user for a valid bearer token', async ({
    request,
  }) => {
    const loginResponse = await request.post(LOGIN_URL, {
      data: {
        username: USERNAME,
        password: PASSWORD,
      },
    });
    const loginBody = (await expectJsonResponse(
      loginResponse,
      200,
    )) as LoginResponse;
    const bearerOnlyContext = await playwrightRequest.newContext();

    try {
      const response = await bearerOnlyContext.get(CURRENT_USER_URL, {
        headers: {
          Authorization: `Bearer ${loginBody.accessToken}`,
        },
      });
      const body = (await expectJsonResponse(
        response,
        200,
      )) as CurrentUserResponse;

      expect(body).toMatchObject({
        id: loginBody.id,
        username: loginBody.username,
        email: loginBody.email,
      });
      expect(body).not.toHaveProperty('accessToken');
      expect(body).not.toHaveProperty('refreshToken');
    } finally {
      await bearerOnlyContext.dispose();
    }
  });

  // Why: /auth/me contains identity data and must deny anonymous callers; accepting
  // a missing token would turn a protected identity endpoint into public data.
  test('returns 401 when the bearer token is missing', async ({ request }) => {
    const response = await request.get(CURRENT_USER_URL);
    const body = await expectJsonResponse(response, 401);

    expect(body).toEqual({ message: 'Access Token is required' });
  });

  // Why: A malformed or expired token must never be treated as authority. This
  // deterministic invalid-token case covers the assignment's invalid-or-expired
  // boundary without introducing a fixed sleep while waiting for token expiry.
  test('returns 401 for an invalid bearer token', async ({ request }) => {
    const response = await request.get(CURRENT_USER_URL, {
      headers: {
        Authorization: 'Bearer definitely-not-a-valid-token',
      },
    });
    const body = await expectJsonResponse(response, 401);

    expect(body).toEqual({ message: 'Invalid/Expired Token!' });
  });
});
