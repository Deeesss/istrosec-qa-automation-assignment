import { expect, test, type APIResponse } from '@playwright/test';

const POSTS_URL = 'https://jsonplaceholder.typicode.com/posts';
const EXISTING_POST_ID = 1;
const MISSING_POST_ID = 999_999;

type Post = {
  userId: number;
  id: number;
  title: string;
  body: string;
};

async function expectJsonResponse(
  response: APIResponse,
  expectedStatus: number,
): Promise<unknown> {
  expect(response.status()).toBe(expectedStatus);
  expect(response.headers()['content-type']).toMatch(/^application\/json(?:;|$)/i);
  return response.json();
}

test.describe('Task 2 - JSONPlaceholder CRUD API', () => {
  test.describe('GET /posts', () => {
    // Checks that the endpoint returns all posts with the expected fields
    // and that every returned value has the correct type and is not empty.
    // Why: API clients need a complete and consistent post structure to process the collection safely.
    test('returns the complete post collection', async ({ request }) => {
      const response = await request.get(POSTS_URL);
      const body = await expectJsonResponse(response, 200);

      expect(Array.isArray(body)).toBe(true);
      const posts = body as Post[];
      expect(posts).toHaveLength(100);
      expect(Object.keys(posts[0]).sort()).toEqual(['body', 'id', 'title', 'userId'].sort());
      expect(
        posts.every(
          (post) =>
            Number.isInteger(post.id) &&
            post.id > 0 &&
            Number.isInteger(post.userId) &&
            post.userId > 0 &&
            typeof post.title === 'string' &&
            post.title.length > 0 &&
            typeof post.body === 'string' &&
            post.body.length > 0,
        ),
      ).toBe(true);
    });

    // Gets an existing post by ID.
    // Checks the post ID, that userId is a number, and that title and body are not empty.
    // Why: Returning the wrong post for an ID could make a client display or modify unrelated data.
    test('returns one existing post by identifier', async ({ request }) => {
      const response = await request.get(`${POSTS_URL}/${EXISTING_POST_ID}`);
      const body = await expectJsonResponse(response, 200);

      expect(body).toEqual({
        userId: expect.any(Number),
        id: EXISTING_POST_ID,
        title: expect.stringMatching(/\S/),
        body: expect.stringMatching(/\S/),
      });
    });

    // Sends a GET request for a post that does not exist.
    // Checks that the API returns 404 and an empty JSON object.
    // Why: Clients must be able to distinguish a missing post from an existing post with empty data.
    test('returns 404 and an empty JSON object for an unknown identifier', async ({
      request,
    }) => {
      const response = await request.get(`${POSTS_URL}/${MISSING_POST_ID}`);
      const body = await expectJsonResponse(response, 404);

      expect(body).toEqual({});
    });
  });

  test.describe('POST /posts', () => {
    // Creates a post and checks the returned fields and generated ID.
    // A following GET confirms that the fake API did not really save it.
    // Why: A successful create response alone does not prove that the new resource was actually persisted.
    test('simulates creation for a valid JSON payload without persisting it', async ({
      request,
    }) => {
      const newPost = {
        title: 'IstroSec API contract',
        body: 'Valid JSONPlaceholder create payload',
        userId: 7,
      };

      const createResponse = await request.post(POSTS_URL, { data: newPost });
      const createdBody = await expectJsonResponse(createResponse, 201);
      expect(createdBody).toEqual({ ...newPost, id: 101 });

      const followUpResponse = await request.get(`${POSTS_URL}/101`);
      const followUpBody = await expectJsonResponse(followUpResponse, 404);
      expect(followUpBody).toEqual({});
    });

    // Sends an incomplete post and confirms that JSONPlaceholder accepts it
    // because this fake API does not enforce required post fields.
    // Why: Missing-field behavior must be known so clients do not assume server-side validation that does not exist.
    test('accepts an incomplete JSON payload because required fields are not enforced', async ({
      request,
    }) => {
      const incompletePost = { title: 'Only a title is supplied' };

      const response = await request.post(POSTS_URL, { data: incompletePost });
      const body = await expectJsonResponse(response, 201);

      expect(body).toEqual({ ...incompletePost, id: 101 });
      expect(body).not.toHaveProperty('body');
      expect(body).not.toHaveProperty('userId');
    });

    // Sends the post data as text/plain instead of JSON.
    // Checks that the API returns 201 but ignores all post fields.
    // Why: Incorrect Content-Type handling can silently discard submitted data while still returning a success status.
    test('drops post fields when the request Content-Type is text/plain', async ({
      request,
    }) => {
      const textPayload = JSON.stringify({
        title: 'Wrong request Content-Type',
        body: 'This body is intentionally sent as text',
        userId: 7,
      });

      const response = await request.post(POSTS_URL, {
        headers: { 'Content-Type': 'text/plain' },
        data: textPayload,
      });
      const body = await expectJsonResponse(response, 201);

      expect(body).toEqual({ id: 101 });
    });
  });

  test.describe('PUT/PATCH /posts/:id', () => {
    // Replaces the whole existing post with PUT.
    // Checks that the API returns exactly the new post data.
    // Why: PUT must replace the complete resource without keeping unexpected values from the previous version.
    test('returns the full replacement for PUT of an existing post', async ({ request }) => {
      const replacement: Post = {
        id: EXISTING_POST_ID,
        title: 'Fully replaced title',
        body: 'Fully replaced body',
        userId: 9,
      };

      const response = await request.put(`${POSTS_URL}/${EXISTING_POST_ID}`, {
        data: replacement,
      });
      const body = await expectJsonResponse(response, 200);

      expect(body).toEqual(replacement);
    });

    // Uses PATCH to change only the title and checks that
    // the original ID, userId and body remain unchanged.
    // Why: PATCH must preserve fields that were not included in the partial update.
    test('merges a partial PATCH into an existing post response', async ({ request }) => {
      const originalResponse = await request.get(`${POSTS_URL}/${EXISTING_POST_ID}`);
      const originalBody = (await expectJsonResponse(originalResponse, 200)) as Post;
      const patch = { title: 'Partially updated title' };

      const patchResponse = await request.patch(`${POSTS_URL}/${EXISTING_POST_ID}`, {
        data: patch,
      });
      const patchedBody = await expectJsonResponse(patchResponse, 200);

      expect(patchedBody).toEqual({ ...originalBody, ...patch });
    });

    // Sends PUT to a post that does not exist and records
    // the current 500 HTML TypeError returned by JSONPlaceholder.
    // Why: An unknown update target must not be mistaken for a successful replacement or a normal JSON error response.
    test('returns the current 500 HTML error for PUT of an unknown post', async ({
      request,
    }) => {
      const replacement: Post = {
        id: MISSING_POST_ID,
        title: 'Unknown post',
        body: 'The target identifier does not exist',
        userId: 9,
      };

      const response = await request.put(`${POSTS_URL}/${MISSING_POST_ID}`, {
        data: replacement,
      });

      expect(response.status()).toBe(500);
      expect(response.headers()['content-type']).toMatch(/^text\/html(?:;|$)/i);
      const body = await response.text();
      expect(body).toContain('TypeError');
    });

    // Sends PATCH to a post that does not exist. The API echoes the data,
    // but a following GET confirms that no new post was created.
    // Why: A successful-looking PATCH response must not be treated as proof that an unknown resource was created.
    test('echoes PATCH data for an unknown post without creating a resource', async ({
      request,
    }) => {
      const patch = { title: 'Unknown partial update' };

      const patchResponse = await request.patch(`${POSTS_URL}/${MISSING_POST_ID}`, {
        data: patch,
      });
      const patchedBody = await expectJsonResponse(patchResponse, 200);
      expect(patchedBody).toEqual(patch);
      expect(patchedBody).not.toHaveProperty('id');

      const followUpResponse = await request.get(`${POSTS_URL}/${MISSING_POST_ID}`);
      const followUpBody = await expectJsonResponse(followUpResponse, 404);
      expect(followUpBody).toEqual({});
    });
  });

  test.describe('DELETE /posts/:id', () => {
    // Deletes an existing post and checks the successful empty response.
    // A following GET confirms that the fake API did not really delete it.
    // Why: A successful delete response alone does not prove that the resource is no longer available.
    test('simulates deletion while leaving the existing post available', async ({
      request,
    }) => {
      const deleteResponse = await request.delete(`${POSTS_URL}/${EXISTING_POST_ID}`);
      const deleteBody = await expectJsonResponse(deleteResponse, 200);
      expect(deleteBody).toEqual({});

      const followUpResponse = await request.get(`${POSTS_URL}/${EXISTING_POST_ID}`);
      const followUpBody = await expectJsonResponse(followUpResponse, 200);
      expect(followUpBody).toEqual({
        userId: expect.any(Number),
        id: EXISTING_POST_ID,
        title: expect.stringMatching(/\S/),
        body: expect.stringMatching(/\S/),
      });
    });

    // Deletes a post that does not exist and confirms that the API
    // still returns the same 200 response with an empty JSON object.
    // Why: Clients must know that this response cannot confirm whether the deleted resource previously existed.
    test('returns the same empty success response for an unknown post', async ({
      request,
    }) => {
      const response = await request.delete(`${POSTS_URL}/${MISSING_POST_ID}`);
      const body = await expectJsonResponse(response, 200);

      expect(body).toEqual({});
    });
  });
});