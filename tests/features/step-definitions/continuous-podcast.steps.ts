import { Given, Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { CustomWorld } from '../support/world';

const episodeIds = new WeakMap<CustomWorld, string>();

Given(
  'I start a continuous podcast about {string} for {int} minutes',
  async function (this: CustomWorld, topic: string, targetDurationMinutes: number) {
    await this.apiRequest('POST', '/api/cast', { topic, targetDurationMinutes });
    expect(this.response?.status).toBe(201);
    const id = this.response?.body?.id;
    expect(typeof id).toBe('string');
    episodeIds.set(this, id);
  },
);

Then('the podcast reports generation progress', async function (this: CustomWorld) {
  const id = episodeIds.get(this);
  expect(id).toBeDefined();
  await this.apiRequest('GET', `/api/cast/${id}/progress`);
  expect(this.response?.status).toBe(200);
  expect(this.response?.body?.targetDurationMinutes).toBe(60);
  expect(this.response?.body?.nextBatchSequence).toBeGreaterThanOrEqual(1);
});

Then(
  'the first batch contains at least {int} ordered exchanges',
  async function (this: CustomWorld, minimumExchanges: number) {
    const id = episodeIds.get(this);
    expect(id).toBeDefined();
    await this.apiRequest('GET', `/api/cast/${id}/batches/1`);
    expect(this.response?.status).toBe(200);
    const exchanges = this.response?.body?.batch?.exchanges;
    expect(Array.isArray(exchanges)).toBe(true);
    expect(exchanges.length).toBeGreaterThanOrEqual(minimumExchanges);
    expect(exchanges.map((exchange: { order: number }) => exchange.order)).toEqual(
      exchanges.map((_: unknown, index: number) => index),
    );
  },
);

When('I stop continuous generation', async function (this: CustomWorld) {
  const id = episodeIds.get(this);
  expect(id).toBeDefined();
  await this.apiRequest('POST', `/api/cast/${id}/stop`);
  expect(this.response?.status).toBe(200);
});

Then('the episode state is {string}', async function (this: CustomWorld, state: string) {
  const id = episodeIds.get(this);
  expect(id).toBeDefined();
  await this.apiRequest('GET', `/api/cast/${id}/progress`);
  expect(this.response?.body?.state).toBe(state);
});
