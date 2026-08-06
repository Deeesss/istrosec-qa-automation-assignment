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
  // Logs in with valid credentials and checks the returned user data.
  // Both access and refresh tokens must be present and different.
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

  // Sends a login request without a password.
  // Checks that the API rejects it with status 400 and the expected message.
  test('rejects a login request with a missing password', async ({ request }) => {
    const response = await request.post(LOGIN_URL, {
      data: { username: USERNAME },
    });
    const body = await expectJsonResponse(response, 400);

    expect(body).toEqual({ message: 'Username and password required' });
  });

  // Sends an incorrect password and checks that login fails.
  // The error response must not contain access or refresh tokens.
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

  // Logs in, sends the access token to /auth/me and checks the returned user.
  // A new request context confirms that authentication works through the bearer token.
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

  // Calls the protected /auth/me endpoint without a bearer token.
  // Checks that the API rejects the request with status 401.
  test('returns 401 when the bearer token is missing', async ({ request }) => {
    const response = await request.get(CURRENT_USER_URL);
    const body = await expectJsonResponse(response, 401);

    expect(body).toEqual({ message: 'Access Token is required' });
  });

  // Calls the protected endpoint with an invalid bearer token.
  // Checks that the API returns status 401 and the expected error message.
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