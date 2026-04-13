/**
 * src/repositories/weblate-commit-event.repository.ts
 *
 * Repository for the weblate_commit_event staging table.
 *
 * Provides standard CRUD via DefaultCrudRepository plus a raw SQL method
 * for the atomic SELECT FOR UPDATE + UPDATE used by the push handler:
 *
 *   claimNewEvents(component, workerHash)
 *     → atomically claims all NEW rows for a component and returns them
 *
 *   deleteByWorkerHash(workerHash)
 *     → deletes all rows this worker claimed, after successful processing
 *
 * Raw SQL is necessary because loopback-connector-postgresql does not
 * expose SELECT FOR UPDATE through the standard filter API.
 */

import { inject } from '@loopback/core';
import { DefaultCrudRepository } from '@loopback/repository';
import { PostgresDataSource } from '../datasources';
import {
    WeblateCommitEvent,
    WeblateCommitEventRelations,
} from '../models/weblate-commit-event.model';

export class WeblateCommitEventRepository extends DefaultCrudRepository<
    WeblateCommitEvent,
    typeof WeblateCommitEvent.prototype.id,
    WeblateCommitEventRelations
> {
    constructor(
        @inject('datasources.postgres') dataSource: PostgresDataSource,
    ) {
        super(WeblateCommitEvent, dataSource);
    }

    /**
     * Atomically claims all NEW rows for a given component.
     *
     * Runs inside a single SQL transaction:
     *   BEGIN
     *   SELECT ... FROM weblate_commit_event
     *     WHERE component = $1 AND status = 'NEW'
     *     FOR UPDATE SKIP LOCKED
     *   UPDATE weblate_commit_event
     *     SET status = 'PROCESSING', worker_hash = $2
     *     WHERE id = ANY($3)
     *   COMMIT
     *
     * SKIP LOCKED ensures concurrent push events for the same component
     * (rare but possible) operate on disjoint row sets without blocking.
     *
     * Returns the claimed rows. If none exist, returns [].
     */
    /**
     * Atomically claims ALL NEW rows across all components.
     *
     * Does NOT filter by component — the component field in the PUSH webhook
     * payload can be unreliable (Weblate may report the wrong component slug).
     * Each claimed row carries its own reliable component+lang from the COMMIT
     * payload that was stored when the row was inserted.
     *
     * SKIP LOCKED ensures concurrent push handlers get disjoint row sets.
     */
    async claimNewEvents(workerHash: string): Promise<WeblateCommitEvent[]> {
        const connector = (this.dataSource as unknown as {
            connector: {
                execute: (
                    sql: string,
                    params: unknown[],
                    options: unknown,
                    cb: (err: Error | null, result: unknown) => void,
                ) => void;
            };
        }).connector;

        return new Promise((resolve, reject) => {
            const selectSql = `
                WITH claimed AS (
                    SELECT id
                    FROM micado.weblate_commit_event
                    WHERE status = 'NEW'
                    FOR UPDATE SKIP LOCKED
                ),
                updated AS (
                    UPDATE micado.weblate_commit_event
                    SET    status = 'PROCESSING',
                           worker_hash = $1
                    WHERE  id IN (SELECT id FROM claimed)
                    RETURNING *
                )
                SELECT
                    id,
                    payload,
                    project,
                    component,
                    lang,
                    change_id      AS "changeId",
                    action,
                    status,
                    worker_hash    AS "workerHash",
                    weblate_ts     AS "weblateTs",
                    received_at    AS "receivedAt"
                FROM updated
            `;

            connector.execute(selectSql, [workerHash], {}, (err, result) => {
                if (err) return reject(err);
                const rows = (result as { rows?: unknown[] }).rows ?? [];
                resolve(rows.map(row => new WeblateCommitEvent(row as Partial<WeblateCommitEvent>)));
            });
        });
    }

    /**
     * Deletes all rows claimed by this worker (identified by workerHash).
     * Called after successful processing.
     * Returns the count of deleted rows.
     */
    async deleteByWorkerHash(workerHash: string): Promise<number> {
        const connector = (this.dataSource as unknown as {
            connector: {
                execute: (
                    sql: string,
                    params: unknown[],
                    options: unknown,
                    cb: (err: Error | null, result: unknown) => void,
                ) => void;
            };
        }).connector;

        return new Promise((resolve, reject) => {
            const sql = `
                DELETE FROM micado.weblate_commit_event
                WHERE worker_hash = $1
            `;
            connector.execute(sql, [workerHash], {}, (err, result) => {
                if (err) return reject(err);
                const count = (result as { count?: number }).count ?? 0;
                resolve(count);
            });
        });
    }

    /**
     * Resets stuck PROCESSING rows back to NEW (for recovery after a crash).
     * Rows that have been PROCESSING for more than `olderThanMinutes` minutes
     * are considered stuck and safe to re-enqueue.
     */
    async resetStuckEvents(olderThanMinutes = 10): Promise<number> {
        const connector = (this.dataSource as unknown as {
            connector: {
                execute: (
                    sql: string,
                    params: unknown[],
                    options: unknown,
                    cb: (err: Error | null, result: unknown) => void,
                ) => void;
            };
        }).connector;

        return new Promise((resolve, reject) => {
            const sql = `
                UPDATE micado.weblate_commit_event
                SET    status = 'NEW',
                       worker_hash = NULL
                WHERE  status = 'PROCESSING'
                  AND  received_at < now() - ($1 || ' minutes')::interval
            `;
            connector.execute(
                sql,
                [String(olderThanMinutes)],
                {},
                (err, result) => {
                    if (err) return reject(err);
                    const count = (result as { count?: number }).count ?? 0;
                    resolve(count);
                },
            );
        });
    }
}