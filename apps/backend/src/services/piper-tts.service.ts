/**
 * src/services/piper-tts.service.ts
 *
 * Calls the Piper TTS microservice (apps/piper) to synthesize an MP3 for a
 * piece of translated/source content. This is the ONLY place that knows how
 * to talk HTTP to Piper and how the shared audio volume is organised —
 * callers (DBOS steps, facades, dev tooling) never build a Piper request or
 * an output path by hand.
 *
 * ── What this replaces ────────────────────────────────────────────────────────
 *
 * `TranslationSteps.generateMp3()` (src/workflows/translation/translation.steps.ts)
 * is currently a STUB that returns a placeholder URL and never calls anything.
 * This service is the real HTTP client that stub will eventually call — see the
 * "NOT wired yet" note below for exactly what is still missing.
 *
 * ── Fire-and-forget contract (matches apps/piper) ─────────────────────────────
 *
 * `POST {PIPER_BASE_URL}/jobs` returns 202 as soon as the job is queued — it
 * does NOT wait for the MP3 to be written. The real result arrives later via
 * a callback POST from Piper to this backend
 * (see PiperTtsCompletedController, src/controllers/webhooks/piper-tts-completed.controller.ts).
 * `requestSynthesis()` below therefore only confirms the job was ACCEPTED,
 * never that the audio exists yet.
 *
 * ── Output path convention ────────────────────────────────────────────────────
 *
 *   <category>/<lang>/<revisionId>.mp3
 *
 *   e.g.  user-types/it/6f2ab3d1-9e4a-4c1a-8b1e-3d0f6a2c9e11.mp3
 *
 * Why this shape (see also the analysis sent alongside this file):
 *   - `category` mirrors the Gitea ARB convention already used for translations
 *     (`<category>/<isoCode>.arb` — see GiteaTranslationExportService.computeRepoPath),
 *     so anyone who knows how translations are organised already knows how audio is.
 *   - `lang` as its own segment matches the same per-language layout, and makes
 *     the `prefix` filter on Piper's debug `GET /files` endpoint actually useful
 *     (e.g. `prefix=user-types/it/`).
 *   - `<revisionId>.mp3` as the filename ties the file 1:1 to an immutable
 *     content_revision: a new revision always gets a new UUID, so the same URL
 *     never needs to change content — safe to serve with a long-lived
 *     `Cache-Control: immutable` header from nginx on PA/migrant (as documented
 *     in the Piper redesign commentary, §8).
 *   - `revisionId` alone is already globally unique (UUID) — category/lang are
 *     not strictly required for uniqueness, but are kept for human debuggability
 *     and consistency with the Gitea path convention above.
 *
 * ── Known limitation — single audio field per revision ────────────────────────
 *
 * `TranslationSteps.generateMp3()` today only ever synthesizes the `title`
 * field. Because of that, one file per (category, lang, revisionId) is
 * unambiguous. If a second TTS-able field (e.g. `description`) is added later,
 * this path convention will need a field discriminator
 * (e.g. `<category>/<lang>/<revisionId>-<field>.mp3`) to avoid collisions —
 * not done here to keep this KISS for the one real need that exists today.
 *
 * ── "processId" — what it means here (READ BEFORE WIRING THE REAL CALLBACK) ──
 *
 * `processId` is deliberately OPAQUE to this service: it is forwarded
 * unchanged as `callback_workflow_id` in the Piper job, and Piper echoes it
 * back unchanged in its completion callback (see TtsCallbackPayload in
 * apps/piper's app/schemas.py). It is NOT the "Process" content type
 * (PROCESS / processId=externalKey used elsewhere in this codebase, e.g.
 * ngo-process-comment.service.ts) — it is whatever correlation id the CALLER
 * needs back to resume work, typically a DBOS workflow id.
 *
 * ASSUMPTION (flagging explicitly — confirm before wiring the real callback
 * logic in PiperTtsCompletedController): the natural value to pass here is
 * the id of the DBOS workflow instance that should be unblocked when the
 * callback arrives — i.e. `wfId.child(revisionId, lang)` for a target
 * language, or `wfId.srcTts(revisionId)` (already reserved in
 * src/workflows/translation/types.ts but currently unused) for the source
 * language. That wiring is intentionally NOT done in this delivery — only
 * this service + the webhook receiver, per the current request.
 *
 * ── HTTP client ────────────────────────────────────────────────────────────────
 *
 * Uses `undici`'s `fetch` — the same choice already made by
 * GiteaTranslationExportService / GiteaTranslationImportService / the Umami
 * service, so no new HTTP dependency is introduced.
 *
 * ── Retry policy ──────────────────────────────────────────────────────────────
 *
 * Only `503` (Piper's queue is full — an explicitly transient condition, see
 * apps/piper's PIPER_QUEUE_MAXSIZE) is retried in-process, with a short
 * exponential backoff, up to PIPER_JOB_MAX_ATTEMPTS attempts. `422`
 * (unsupported language) and `400` (invalid path — should not happen since
 * this service builds and validates the path itself) are NOT retried: they
 * are definitive rejections. Network errors and 5xx from Piper are surfaced
 * as HttpErrors.BadGateway without a retry here — the DBOS @step that will
 * eventually call this already retries on failure (see generateMp3's
 * `{ retriesAllowed: true, maxAttempts: 5 }` decorator).
 */

import { injectable, BindingScope, inject } from '@loopback/core';
import { HttpErrors } from '@loopback/rest';
import { LoggingBindings } from '@loopback/logging';
import { fetch } from 'undici';
import type { Logger } from 'winston';

// ── Piper job contract (mirrors apps/piper's SynthesisJobRequest schema) ──────

/** Default topic used for every Piper TTS callback. Piper treats it as opaque
 *  and echoes it back unchanged — this backend is free to route on it later. */
const DEFAULT_CALLBACK_TOPIC = 'piper-tts';

const JOBS_PATH = '/jobs';

// Defense in depth: these values normally come from server-controlled data
// (CATEGORY_BY_TYPE, the language repository, a content_revision UUID) and
// not directly from end-user input, but we validate anyway before building a
// filesystem path — mirrors GiteaTranslationExportService.validateRequest().
const CATEGORY_PATTERN = /^[a-z0-9_-]+$/i;
const LANG_PATTERN = /^[a-z]{2}([_-][a-z0-9]+)?$/i;
const REVISION_ID_PATTERN = /^[a-z0-9-]+$/i;

export type PiperSynthesisRequest = {
    /** Text to synthesize. */
    text: string;
    /** Content category — Gitea folder name, e.g. 'user-types', 'processes'. */
    category: string;
    /** UUID of the content_revision this audio belongs to. */
    revisionId: string;
    /** Opaque correlation id, forwarded verbatim to Piper and echoed back in
     *  the callback as `callback_workflow_id` — see class docstring. */
    processId: string;
    /** ISO 639-1 language code, e.g. 'it'. */
    lang: string;
};

export type PiperSynthesisAccepted = {
    /** Path relative to the shared audio volume Piper will write to. */
    outputRelativePath: string;
    /** Position in Piper's internal queue at accept time (diagnostic only). */
    queuedPosition: number;
    /** Echoed back verbatim by Piper's callback. */
    callbackWorkflowId: string;
    callbackTopic: string;
};

@injectable({ scope: BindingScope.SINGLETON })
export class PiperTtsService {

    static readonly BINDING = 'services.PiperTtsService';

    constructor(
        @inject(LoggingBindings.WINSTON_LOGGER)
        private readonly logger: Logger,
    ) { }

    /**
     * Builds the output path, POSTs the job to Piper, and returns once Piper
     * has ACCEPTED it (202). Does NOT wait for the MP3 to exist — see class
     * docstring for the async callback contract.
     *
     * @throws HttpErrors.UnprocessableEntity  lang has no mapped Piper voice (422, not retried)
     * @throws HttpErrors.BadRequest            built path rejected by Piper (400, not retried — should not happen)
     * @throws HttpErrors.ServiceUnavailable    queue still full after retries (503)
     * @throws HttpErrors.BadGateway            network error or unexpected Piper response
     */
    async requestSynthesis(input: PiperSynthesisRequest): Promise<PiperSynthesisAccepted> {
        const tag = '[PiperTts]';
        this.validateInput(input);

        const outputRelativePath = this.buildOutputRelativePath(input);
        const callbackWorkflowId = input.processId;
        const callbackTopic = DEFAULT_CALLBACK_TOPIC;

        const baseUrl = this.readRequiredBaseUrl();
        const url = `${baseUrl}${JOBS_PATH}`;

        const body = {
            text: input.text,
            lang: input.lang.toLowerCase(),
            output_relative_path: outputRelativePath,
            callback_workflow_id: callbackWorkflowId,
            callback_topic: callbackTopic,
        };

        this.logger.info(`${tag} requestSynthesis start ${JSON.stringify({
            url,
            category: input.category,
            lang: input.lang,
            revisionId: input.revisionId,
            processId: input.processId,
            outputRelativePath,
            textLength: input.text.length,
        })}`);

        const maxAttempts = this.readMaxAttempts();

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            let response: Awaited<ReturnType<typeof fetch>>;
            try {
                response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
            } catch (err) {
                this.logger.error(`${tag} network error ${JSON.stringify({
                    url, revisionId: input.revisionId, lang: input.lang, attempt, maxAttempts, error: String(err),
                })}`);
                throw new HttpErrors.BadGateway(`Network error calling Piper: ${String(err)}`);
            }

            if (response.status === 202) {
                const json = await this.safeJson(response) as { queued_position?: number } | null;
                const queuedPosition = json?.queued_position ?? -1;

                this.logger.info(`${tag} requestSynthesis accepted ${JSON.stringify({
                    revisionId: input.revisionId, lang: input.lang, outputRelativePath, queuedPosition, attempt,
                })}`);

                return { outputRelativePath, queuedPosition, callbackWorkflowId, callbackTopic };
            }

            if (response.status === 422) {
                const detail = await this.safeText(response);
                this.logger.warn(`${tag} REJECTED unsupported lang ${JSON.stringify({
                    revisionId: input.revisionId, lang: input.lang, detail,
                })}`);
                throw new HttpErrors.UnprocessableEntity(`Piper has no voice for lang '${input.lang}': ${detail}`);
            }

            if (response.status === 400) {
                const detail = await this.safeText(response);
                this.logger.error(`${tag} REJECTED invalid path — check buildOutputRelativePath() ${JSON.stringify({
                    revisionId: input.revisionId, outputRelativePath, detail,
                })}`);
                throw new HttpErrors.BadRequest(`Piper rejected output_relative_path: ${detail}`);
            }

            if (response.status === 503) {
                const detail = await this.safeText(response);
                if (attempt < maxAttempts) {
                    const delayMs = 500 * 2 ** (attempt - 1);
                    this.logger.warn(`${tag} queue full — retrying ${JSON.stringify({
                        revisionId: input.revisionId, lang: input.lang, attempt, maxAttempts, delayMs, detail,
                    })}`);
                    await this.delay(delayMs);
                    continue;
                }
                this.logger.error(`${tag} queue still full after ${maxAttempts} attempts ${JSON.stringify({
                    revisionId: input.revisionId, lang: input.lang, detail,
                })}`);
                throw new HttpErrors.ServiceUnavailable(`Piper queue is full after ${maxAttempts} attempts: ${detail}`);
            }

            // Any other status is unexpected — surfaced as a gateway error, not retried.
            const detail = await this.safeText(response);
            this.logger.error(`${tag} unexpected response ${JSON.stringify({
                revisionId: input.revisionId, lang: input.lang, status: response.status, detail,
            })}`);
            throw new HttpErrors.BadGateway(`Unexpected Piper response ${response.status}: ${detail}`);
        }

        // Unreachable — the loop above always returns or throws — but keeps TS happy.
        throw new HttpErrors.BadGateway('Piper request failed after exhausting retries.');
    }

    // ── Path building (the "encapsulated" logic the caller should never redo) ──

    private buildOutputRelativePath(input: PiperSynthesisRequest): string {
        return `${input.category}/${input.lang.toLowerCase()}/${input.revisionId}.mp3`;
    }

    // ── Validation ─────────────────────────────────────────────────────────────

    private validateInput(input: PiperSynthesisRequest): void {
        if (!input.text?.trim()) {
            throw new HttpErrors.BadRequest('text is required.');
        }
        if (!CATEGORY_PATTERN.test(input.category ?? '')) {
            throw new HttpErrors.BadRequest(
                `Invalid category '${input.category}'. Allowed chars: letters, numbers, underscore, dash.`,
            );
        }
        if (!LANG_PATTERN.test(input.lang ?? '')) {
            throw new HttpErrors.BadRequest(`Invalid lang '${input.lang}'. Expected values like en, it, pt-BR.`);
        }
        if (!REVISION_ID_PATTERN.test(input.revisionId ?? '')) {
            throw new HttpErrors.BadRequest(`Invalid revisionId '${input.revisionId}'.`);
        }
        if (!input.processId?.trim()) {
            throw new HttpErrors.BadRequest('processId is required (used as callback_workflow_id).');
        }
    }

    // ── Config ─────────────────────────────────────────────────────────────────

    /** PIPER_BASE_URL is already set on the `backend` service in docker-compose.yml
     *  (e.g. http://piper:8080) — no new env var to add for this. */
    private readRequiredBaseUrl(): string {
        const raw = process.env.PIPER_BASE_URL?.trim();
        if (!raw) {
            this.logger.error('[PiperTts] Missing required configuration: PIPER_BASE_URL');
            throw new Error('Missing required configuration: PIPER_BASE_URL');
        }
        return raw.replace(/\/$/, '');
    }

    private readMaxAttempts(): number {
        const raw = process.env.PIPER_JOB_MAX_ATTEMPTS?.trim();
        const parsed = raw ? Number.parseInt(raw, 10) : NaN;
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    private async safeJson(response: Awaited<ReturnType<typeof fetch>>): Promise<unknown> {
        try {
            return await response.json();
        } catch {
            return null;
        }
    }

    private async safeText(response: Awaited<ReturnType<typeof fetch>>): Promise<string> {
        try {
            return await response.text();
        } catch {
            return '(unreadable body)';
        }
    }

    private async delay(milliseconds: number): Promise<void> {
        await new Promise<void>(resolve => setTimeout(resolve, milliseconds));
    }
}
