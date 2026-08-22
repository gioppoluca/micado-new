import {Client, type ClientConfig, type QueryResultRow} from 'pg';

/** Run a read-only assertion query and always release the PostgreSQL socket. */
export async function queryPostgres<T extends QueryResultRow>(
  config: ClientConfig,
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const client = new Client({
    ...config,
    application_name: 'micado-playwright-complete-business-logic',
  });

  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const result = await client.query<T>(text, values);
    await client.query('COMMIT');
    return result.rows;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}
