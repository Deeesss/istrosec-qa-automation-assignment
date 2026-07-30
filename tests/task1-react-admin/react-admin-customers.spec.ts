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
    const nameCell = rows.nth(index).getByRole('cell').nth(1);
    const tokens = (await nameCell.innerText()).trim().split(/\s+/);
    names.push(tokens.at(-1) ?? '');
  }

  return names;
}

test.describe('Task 1 - React Admin customer management', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  // Why: Operators must be able to narrow a large customer set without silently
  // keeping unrelated records that could lead to editing the wrong account.
  test('filters the customer list by a visible customer name', async ({ page }) => {
    await openCustomers(page);
    const rows = customerRows(page);
    const initialRowCount = await rows.count();
    const firstCustomerLink = rows.first().getByRole('link');
    const visibleNameLines = (await firstCustomerLink.innerText())
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const searchTerm = visibleNameLines.at(-1) ?? '';

    expect(initialRowCount).toBeGreaterThan(1);
    expect(searchTerm).not.toBe('');
    await page.getByRole('textbox', { name: 'Search' }).fill(searchTerm);

    await expect
      .poll(() => listParameters(page).get('filter'))
      .toBe(JSON.stringify({ q: searchTerm }));
    await expect(
      page.getByRole('table').getByRole('link').filter({ hasText: searchTerm }),
    ).toBeVisible();
    await expect.poll(() => rows.count()).toBeLessThan(initialRowCount);
  });

  // Why: A sort control is only trustworthy when both its state and the rendered
  // data order change together; a cosmetic arrow alone can hide incorrect ordering.
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

  // Why: Pagination must advance the data window as well as the page indicator;
  // otherwise operators can believe they reviewed records that were never displayed.
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

  // Why: A missing last name must block creation because the list and edit views
  // use the customer's full name as the primary human-readable identity.
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

  // Why: Successful submission must expose the saved identity on the resulting
  // edit page so the operator can verify which customer record was created.
  test('creates a customer and shows the persisted form values', async ({ page }) => {
    const customer = {
      firstName: 'Istrosec',
      lastName: 'Created',
      email: 'istrosec.created@example.com',
    };

    await createCustomer(page, customer);

    await expect(page.getByRole('alert')).toContainText('Customer created');
    await expect(page.getByRole('textbox', { name: 'First name' })).toHaveValue(
      customer.firstName,
    );
    await expect(page.getByRole('textbox', { name: 'Last name' })).toHaveValue(
      customer.lastName,
    );
    await expect(page.getByRole('textbox', { name: 'Email' })).toHaveValue(customer.email);
  });

  // Why: The demo has no explicit Cancel button, so leaving the edit route is its
  // cancel equivalent; unsaved values must not leak into the stored customer record.
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

  // Why: Deletion must confirm completion and remove the exact disposable record;
  // redirecting to the list without proving absence could hide a failed mutation.
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
