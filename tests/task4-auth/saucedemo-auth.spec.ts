import { expect, test, type Page } from '@playwright/test';

const BASE_URL = 'https://www.saucedemo.com/';
const INVENTORY_URL = `${BASE_URL}inventory.html`;
const VALID_USERNAME = 'standard_user';
const VALID_PASSWORD = 'secret_sauce';

async function submitLogin(
  page: Page,
  username: string,
  password: string,
): Promise<void> {
  await page.goto(BASE_URL);
  await page.getByPlaceholder('Username').fill(username);
  await page.getByPlaceholder('Password').fill(password);
  await page.getByRole('button', { name: 'Login' }).click();
}

function inventoryList(page: Page) {
  return page.locator('[data-test="inventory-list"]');
}

test.describe('Task 4A - SauceDemo UI authentication', () => {
  // Logs in with valid credentials.
  // Checks that the inventory page and its content are visible.
  test('allows a valid user to access the protected inventory', async ({ page }) => {
    await submitLogin(page, VALID_USERNAME, VALID_PASSWORD);

    await expect(page).toHaveURL(INVENTORY_URL);
    await expect(page.getByText('Products', { exact: true })).toBeVisible();
    await expect(inventoryList(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open Menu' })).toBeVisible();
  });

  // Logs in with an incorrect password.
  // Checks that login fails and the inventory is not displayed.
  test('rejects invalid credentials without exposing protected content', async ({
    page,
  }) => {
    await submitLogin(page, VALID_USERNAME, 'wrong-password');

    await expect(page).toHaveURL(BASE_URL);
    await expect(
      page.getByText(
        'Epic sadface: Username and password do not match any user in this service',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();
    await expect(inventoryList(page)).toHaveCount(0);
  });

  // Tries to log in with a locked user.
  // Checks that the correct locked-account message is displayed.
  test('denies the locked user with the locked-account message', async ({ page }) => {
    await submitLogin(page, 'locked_out_user', VALID_PASSWORD);

    await expect(page).toHaveURL(BASE_URL);
    await expect(
      page.getByText('Epic sadface: Sorry, this user has been locked out.', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();
    await expect(inventoryList(page)).toHaveCount(0);
  });

  // Opens the inventory URL without logging in.
  // Checks that the user is returned to login and cannot see the inventory.
  test('blocks direct anonymous access to the protected inventory URL', async ({
    page,
  }) => {
    await page.goto(INVENTORY_URL);

    await expect(page).toHaveURL(BASE_URL);
    await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();
    await expect(
      page.getByText(
        "Epic sadface: You can only access '/inventory.html' when you are logged in.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(inventoryList(page)).toHaveCount(0);
  });

  // Logs in and then logs out.
  // Checks that the inventory cannot be opened again after logout.
  test('ends the session on logout and blocks a protected revisit', async ({ page }) => {
    await submitLogin(page, VALID_USERNAME, VALID_PASSWORD);
    await expect(inventoryList(page)).toBeVisible();

    await page.getByRole('button', { name: 'Open Menu' }).click();
    await page.getByRole('link', { name: 'Logout' }).click();

    await expect(page).toHaveURL(BASE_URL);
    await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();
    await expect(inventoryList(page)).toHaveCount(0);

    await page.goto(INVENTORY_URL);

    await expect(page).toHaveURL(BASE_URL);
    await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();
    await expect(
      page.getByText(
        "Epic sadface: You can only access '/inventory.html' when you are logged in.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(inventoryList(page)).toHaveCount(0);
  });
});