import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

const BASE_URL = 'https://marmelab.com/react-admin-demo/';
const CUSTOMERS_URL = `${BASE_URL}#/customers`;

type Customer = {
  firstName: string;
  lastName: string;
  email: string;
};

async function login(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  await page.getByRole('textbox', { name: 'Username' }).fill('demo');
  await page.getByRole('textbox', { name: 'Password' }).fill('demo');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(`${BASE_URL}#/`);
}

async function openCustomers(page: Page): Promise<void> {
  await page.goto(CUSTOMERS_URL);
  await expect(page.getByRole('heading', { name: 'Customers' })).toBeVisible();
  await expect(page.getByText(/^1-25 of \d+$/)).toBeVisible();
}

async function createCustomer(page: Page, customer: Customer): Promise<string> {
  await page.goto(`${CUSTOMERS_URL}/create`);
  await page.getByRole('textbox', { name: 'First name' }).fill(customer.firstName);
  await page.getByRole('textbox', { name: 'Last name' }).fill(customer.lastName);
  await page.getByRole('textbox', { name: 'Email' }).fill(customer.email);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/customers\/\d+$/);
  return page.url();
}

function customerRows(page: Page) {
  return page.getByRole('table').locator('tbody').getByRole('row');
}

function listParameters(page: Page): URLSearchParams {
  const query = new URL(page.url()).hash.split('?')[1] ?? '';
  return new URLSearchParams(query);
}

async function visibleLastNames(page: Page): Promise<string[]> {
  const rows = customerRows(page);
  const names: string[] = [];

  for (let index = 0; index < (await rows.count()); index += 1) {
    const nameLink = rows.nth(index).getByRole('link');
    const tokens = (await nameLink.innerText()).trim().split(/\s+/);
    names.push(tokens.at(-1) ?? '');
  }

  return names;
}

test.describe('Task 1 - React Admin customer management', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  // Creates a customer with a unique last name and searches for that customer.
  // Checks that the list gets shorter and every remaining customer matches the search.
  // Why: Incorrect filtering could leave unrelated records visible and lead an operator to open or edit the wrong customer.
  test('filters the customer list to the customer with the searched last name', async ({ page }) => {
    const searchTerm = `Filter${randomUUID().replaceAll('-', '')}`;
    const customer = {
      firstName: 'Istrosec',
      lastName: searchTerm,
      email: `${searchTerm.toLowerCase()}@example.com`,
    };
    const editUrl = await createCustomer(page, customer);
    await openCustomers(page);
    const rows = customerRows(page);
    const initialRowCount = await rows.count();

    expect(initialRowCount).toBeGreaterThan(1);
    await page.getByRole('textbox', { name: 'Search' }).fill(searchTerm);

    await expect
      .poll(() => listParameters(page).get('filter'))
      .toBe(JSON.stringify({ q: searchTerm }));
    await expect(
      page.getByRole('table').getByRole('link').filter({ hasText: searchTerm }),
    ).toBeVisible();
    await expect.poll(() => rows.count()).toBeLessThan(initialRowCount);
    await expect(rows).toHaveCount(1);
    await expect(rows.getByRole('link')).toContainText(searchTerm);
    await expect(rows.getByRole('link')).toHaveAttribute('href', new URL(editUrl).hash);
    await expect(page.getByText('1-1 of 1', { exact: true })).toBeVisible();
  });

  // Sorts customer last names in ascending and descending order.
  // Checks both the selected sort settings and the displayed name order.
  // Why: Incorrect sorting can place records in an unexpected order and cause an operator to select the wrong customer.
  test('sorts customer names in ascending and descending order', async ({ page }) => {
    await openCustomers(page);

    await page.getByRole('button', { name: 'Sort by name ascending' }).click();
    await expect
      .poll(() => ({
        order: listParameters(page).get('order'),
        sort: listParameters(page).get('sort'),
      }))
      .toEqual({ order: 'ASC', sort: 'last_name' });
    await expect(page.getByRole('button', { name: 'Sort by name descending' })).toBeVisible();
    await expect
      .poll(async () => {
        const names = await visibleLastNames(page);
        return names.join('|') === [...names].sort().join('|');
      })
      .toBe(true);

    const ascendingLastNames = await visibleLastNames(page);
    expect(ascendingLastNames).toEqual([...ascendingLastNames].sort());

    await page.getByRole('button', { name: 'Sort by name descending' }).click();
    await expect.poll(() => listParameters(page).get('order')).toBe('DESC');
    await expect
      .poll(async () => {
        const names = await visibleLastNames(page);
        return names.join('|') === [...names].sort().reverse().join('|');
      })
      .toBe(true);

    const descendingLastNames = await visibleLastNames(page);
    expect(descendingLastNames).toEqual([...descendingLastNames].sort().reverse());
  });

  // Opens the second page of customers.
  // Checks that the page number and displayed customer data both change.
  // Why: Broken pagination can make operators believe they reviewed different records while the application still shows the same data.
  test('moves from the first customer page to the second data page', async ({ page }) => {
    await openCustomers(page);
    const firstPageFirstCustomer = await customerRows(page)
      .first()
      .getByRole('link')
      .getAttribute('href');

    await expect(page.getByText(/^1-25 of \d+$/)).toBeVisible();
    await page.getByRole('button', { name: 'Go to page 2' }).click();

    await expect.poll(() => listParameters(page).get('page')).toBe('2');
    await expect(page.getByRole('button', { name: 'Page 2', exact: true })).toBeVisible();
    await expect(page.getByText(/^26-50 of \d+$/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Go to previous page' })).toBeEnabled();
    await expect
      .poll(() => customerRows(page).first().getByRole('link').getAttribute('href'))
      .not.toBe(firstPageFirstCustomer);

    const secondPageFirstCustomer = await customerRows(page)
      .first()
      .getByRole('link')
      .getAttribute('href');
    expect(secondPageFirstCustomer).not.toBe(firstPageFirstCustomer);
  });

  // Tries to create a customer without the required last name.
  // Checks that the form shows validation errors and is not submitted.
  // Why: Required-field validation prevents incomplete customer records from being created and becoming difficult to identify.
  test('rejects a customer form with a missing required last name', async ({ page }) => {
    await page.goto(`${CUSTOMERS_URL}/create`);
    await page.getByRole('textbox', { name: 'First name' }).fill('Validation');
    await page.getByRole('textbox', { name: 'Email' }).fill('validation@example.com');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByRole('textbox', { name: 'Last name' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await expect(page.getByText('Required', { exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText(
      'The form is not valid. Please check for errors',
    );
    await expect(page).toHaveURL(`${CUSTOMERS_URL}/create`);
  });

  // Creates a new customer with valid data.
  // Opens the saved customer again and checks that all entered values are still there.
  // Why: After creation, the operator must be able to confirm that the intended customer data was saved correctly.
  test('creates a customer and shows the persisted form values', async ({ page }) => {
    const customer = {
      firstName: 'Istrosec',
      lastName: 'Created',
      email: 'istrosec.created@example.com',
    };

    const editUrl = await createCustomer(page, customer);

    await expect(page.getByRole('alert')).toContainText('Customer created');
    await openCustomers(page);
    await page.goto(editUrl);
    await expect(page.getByRole('textbox', { name: 'First name' })).toHaveValue(
      customer.firstName,
    );
    await expect(page.getByRole('textbox', { name: 'Last name' })).toHaveValue(
      customer.lastName,
    );
    await expect(page.getByRole('textbox', { name: 'Email' })).toHaveValue(customer.email);
  });

  // Changes a customer value but leaves the page without saving.
  // Checks that the original customer data remains unchanged.
  // Why: Leaving the form without saving must not silently change the stored customer record.
  test('discards an unsaved edit when the operator leaves the form', async ({ page }) => {
    const customer = {
      firstName: 'Istrosec',
      lastName: 'Unchanged',
      email: 'istrosec.unchanged@example.com',
    };
    const editUrl = await createCustomer(page, customer);

    await page.getByRole('textbox', { name: 'First name' }).fill('Modified');
    await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();
    await openCustomers(page);
    await page.goto(editUrl);

    await expect(page.getByRole('textbox', { name: 'First name' })).toHaveValue(
      customer.firstName,
    );
    await expect(page.getByRole('textbox', { name: 'Last name' })).toHaveValue(
      customer.lastName,
    );
  });

  // Creates and deletes a customer.
  // Searches for the customer afterward to confirm that it is gone.
  // Why: Deletion must remove the intended record and provide visible confirmation so stale customer data is not mistaken for an active record.
  test('deletes a created customer and confirms that it is gone', async ({ page }) => {
    const customer = {
      firstName: 'Istrosec',
      lastName: 'Disposable',
      email: 'istrosec.disposable@example.com',
    };
    const fullName = `${customer.firstName} ${customer.lastName}`;
    await createCustomer(page, customer);

    await page.getByRole('button', { name: 'Delete' }).click();

    await expect(page).toHaveURL(/#\/customers(?:\?|$)/);
    await expect(page.getByRole('alert')).toContainText('Customer deleted');
    await expect(page.getByRole('alert')).toBeHidden({ timeout: 10_000 });
    await page.getByRole('textbox', { name: 'Search' }).fill(fullName);
    await expect
      .poll(() => listParameters(page).get('filter'))
      .toBe(JSON.stringify({ q: fullName }));
    await expect(page.getByRole('table').getByText(fullName, { exact: true })).toHaveCount(0, {
      timeout: 10_000,
    });
  });
});
