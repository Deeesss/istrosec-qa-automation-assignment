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
    // Why: Collection consumers require a predictable array of complete posts;
    // returning a partial or differently shaped collection would break list processing.
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

    // Why: Fetching a known identifier must return the matching resource rather
    // than an arbitrary collection item, otherwise callers can act on the wrong post.
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

    // Why: A missing identifier must be distinguishable from an existing post so
    // clients do not treat an empty object as valid business data.
    test('returns 404 and an empty JSON object for an unknown identifier', async ({
      request,
    }) => {
      const response = await request.get(`${POSTS_URL}/${MISSING_POST_ID}`);
      const body = await expectJsonResponse(response, 404);

      expect(body).toEqual({});
    });
  });

  test.describe('POST /posts', () => {
    // Why: The create response must echo the submitted fields and assign an ID,
    // while a follow-up GET proves that this fake API did not persist the resource.
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

    // Why: The assignment asks about required fields, but this public fake API has
    // no post schema validation; documenting acceptance prevents a false claim that
    // our tests proved server-side validation that does not exist.
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

    // Why: A client that declares text/plain sends data the server does not parse;
    // the 201 status alone would hide that every submitted post field was discarded.
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
    // Why: PUT represents full replacement, so the response must contain the exact
    // complete representation supplied by the caller, including the route identity.
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

    // Why: PATCH must change only the supplied field. Losing the original body or
    // owner during a partial update would silently corrupt unrelated post data.
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

    // Why: PUT against an unknown ID currently exposes a server error and HTML stack
    // trace. Capturing that behavior prevents us from pretending it is a clean 404.
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
      expect(body).toContain("reading 'id'");
    });

    // Why: PATCH of an unknown ID returns a successful-looking object without an ID;
    // the follow-up 404 proves it was not created and prevents false upsert semantics.
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
    // Why: JSONPlaceholder acknowledges deletion but does not persist it. Proving
    // the post is still readable prevents a 200 response from being misreported as
    // evidence that a database record was actually removed.
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

    // Why: Deleting an unknown ID returns the same success response as deleting an
    // existing one, so clients cannot use this response to prove prior existence.
    test('returns the same empty success response for an unknown post', async ({
      request,
    }) => {
      const response = await request.delete(`${POSTS_URL}/${MISSING_POST_ID}`);
      const body = await expectJsonResponse(response, 200);

      expect(body).toEqual({});
    });
  });
});
