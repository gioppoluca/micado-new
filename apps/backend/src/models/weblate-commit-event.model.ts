/**
 * src/models/weblate-commit-event.model.ts
 *
 * LoopBack model for the micado.weblate_commit_event staging table.
 *
 * Rows are inserted by the /translation-committed webhook controller
 * and consumed + deleted by the /translation-pushed webhook controller.
 *
 * See migrations/weblate_commit_event.sql for the full schema and lifecycle docs.
 */

import { Entity, model, property } from '@loopback/repository';

@model({
    settings: {
        postgresql: {
            schema: 'micado',
            table: 'weblate_commit_event',
        },
    },
})
export class WeblateCommitEvent extends Entity {

    @property({
        type: 'string',
        id: true,
        generated: false,
        defaultFn: 'uuidv4',
        postgresql: {
            columnName: 'id',
            dataType: 'uuid',
        },
    })
    id?: string;

    /** Full Weblate webhook body, stored as-is for auditability */
    @property({
        type: 'object',
        required: true,
        postgresql: {
            columnName: 'payload',
            dataType: 'jsonb',
        },
    })
    payload: Record<string, unknown>;

    /** Weblate project slug — always 'micado' in this deployment */
    @property({
        type: 'string',
        required: true,
        postgresql: { columnName: 'project', dataType: 'text' },
    })
    project: string;

    /** Component slug = Gitea folder = content-type category (e.g. 'user-types') */
    @property({
        type: 'string',
        required: true,
        postgresql: { columnName: 'component', dataType: 'text' },
    })
    component: string;

    /** ISO language code (e.g. 'it', 'fr') */
    @property({
        type: 'string',
        required: true,
        postgresql: { columnName: 'lang', dataType: 'text' },
    })
    lang: string;

    /** Weblate Change PK — useful for deduplication and debugging */
    @property({
        type: 'number',
        required: true,
        postgresql: { columnName: 'change_id', dataType: 'integer' },
    })
    changeId: number;

    /** Human-readable action string from Weblate (e.g. 'Changes committed') */
    @property({
        type: 'string',
        required: true,
        postgresql: { columnName: 'action', dataType: 'text' },
    })
    action: string;

    /**
     * Lifecycle status:
     *   NEW        — arrived, not yet claimed by a push handler
     *   PROCESSING — claimed (stamped with workerHash), being processed
     *   (deleted)  — after successful processing
     */
    @property({
        type: 'string',
        required: true,
        default: 'NEW',
        jsonSchema: { enum: ['NEW', 'PROCESSING'] },
        postgresql: { columnName: 'status', dataType: 'text' },
    })
    status: 'NEW' | 'PROCESSING';

    /**
     * Set during SELECT FOR UPDATE by the push handler.
     * Used to identify rows claimed by THIS invocation for deletion.
     * NULL when status = 'NEW'.
     */
    @property({
        type: 'string',
        postgresql: { columnName: 'worker_hash', dataType: 'text' },
    })
    workerHash?: string;

    /** Timestamp from the Weblate payload (when the commit happened in Weblate) */
    @property({
        type: 'date',
        required: true,
        postgresql: { columnName: 'weblate_ts', dataType: 'timestamptz' },
    })
    weblateTs: string;

    /** When the backend received this webhook */
    @property({
        type: 'date',
        defaultFn: 'now',
        postgresql: { columnName: 'received_at', dataType: 'timestamptz' },
    })
    receivedAt?: string;

    constructor(data?: Partial<WeblateCommitEvent>) {
        super(data);
    }
}

export interface WeblateCommitEventRelations { }

export type WeblateCommitEventWithRelations = WeblateCommitEvent &
    WeblateCommitEventRelations;