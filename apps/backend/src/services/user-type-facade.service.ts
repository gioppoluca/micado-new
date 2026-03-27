import { injectable, BindingScope } from '@loopback/core';
import { Filter, repository } from '@loopback/repository';
import { HttpErrors } from '@loopback/rest';
import {
    ContentItem,
    ContentRevision,
    ContentRevisionTranslation,
    UserTypeLegacy,
} from '../models';
import {
    ContentItemRepository,
    ContentRevisionRepository,
    ContentRevisionTranslationRepository,
} from '../repositories';

const USER_TYPE_CODE = 'USER_TYPE';

@injectable({ scope: BindingScope.SINGLETON })
export class UserTypeFacadeService {
    constructor(
        @repository(ContentItemRepository)
        protected contentItemRepository: ContentItemRepository,
        @repository(ContentRevisionRepository)
        protected contentRevisionRepository: ContentRevisionRepository,
        @repository(ContentRevisionTranslationRepository)
        protected contentRevisionTranslationRepository: ContentRevisionTranslationRepository,
    ) { }

    async create(input: Omit<UserTypeLegacy, 'id' | 'status'>): Promise<UserTypeLegacy> {
        const externalKey = String(await this.nextExternalKey());
        const sourceLang = input.sourceLang ?? 'en';

        const item = await this.contentItemRepository.create({
            typeCode: USER_TYPE_CODE,
            externalKey,
        });

        const revision = await this.contentRevisionRepository.create({
            itemId: item.id!,
            revisionNo: 1,
            status: 'DRAFT',
            sourceLang,
            dataExtra: input.dataExtra ?? {},
        });

        await this.contentRevisionTranslationRepository.create({
            revisionId: revision.id!,
            lang: sourceLang,
            title: input.user_type ?? '',
            description: input.description ?? '',
            i18nExtra: {},
            tStatus: 'DRAFT',
        });

        return this.toLegacyDto(item, revision, {
            lang: sourceLang,
            title: input.user_type ?? '',
            description: input.description ?? '',
        });
    }

    async count(where?: Record<string, unknown>): Promise<{ count: number }> {
        const mappedWhere: Record<string, unknown> = {
            typeCode: USER_TYPE_CODE,
        };

        if (where?.id != null) {
            mappedWhere.externalKey = String(where.id);
        }

        const result = await this.contentItemRepository.count(mappedWhere);
        return { count: result.count };
    }

    async find(_filter?: Filter<UserTypeLegacy>): Promise<UserTypeLegacy[]> {
        const items = await this.contentItemRepository.find({
            where: { typeCode: USER_TYPE_CODE },
            order: ['externalKey ASC'],
        });

        const result: UserTypeLegacy[] = [];

        for (const item of items) {
            const draftOrPublished = await this.findPreferredRevision(item.id!);
            if (!draftOrPublished) continue;

            const sourceTranslation =
                await this.contentRevisionTranslationRepository.findOne({
                    where: {
                        revisionId: draftOrPublished.id,
                        lang: draftOrPublished.sourceLang,
                    },
                });

            result.push(
                this.toLegacyDto(item, draftOrPublished, sourceTranslation ?? undefined),
            );
        }

        return result;
    }

    async findById(id: number): Promise<UserTypeLegacy> {
        const item = await this.findItemByLegacyIdOrFail(id);
        const revision = await this.findPreferredRevision(item.id!);

        if (!revision) {
            throw new HttpErrors.NotFound(
                `No revision found for USER_TYPE ${id}`,
            );
        }

        const translation = await this.contentRevisionTranslationRepository.findOne({
            where: {
                revisionId: revision.id,
                lang: revision.sourceLang,
            },
        });

        return this.toLegacyDto(item, revision, translation ?? undefined);
    }

    async updateById(id: number, patch: Partial<UserTypeLegacy>): Promise<void> {
        const item = await this.findItemByLegacyIdOrFail(id);
        const draft = await this.findOrCreateDraft(item);

        const dataExtra = {
            ...(draft.dataExtra ?? {}),
            ...(patch.dataExtra ?? {}),
        };

        await this.contentRevisionRepository.updateById(draft.id!, {
            dataExtra,
        });

        if (
            patch.user_type !== undefined ||
            patch.description !== undefined
        ) {
            const lang = patch.sourceLang ?? draft.sourceLang;

            const existingTranslation =
                await this.contentRevisionTranslationRepository.findOne({
                    where: {
                        revisionId: draft.id!,
                        lang,
                    },
                });

            if (existingTranslation) {
                await this.contentRevisionTranslationRepository.updateById(
                    existingTranslation.id!,
                    {
                        title:
                            patch.user_type !== undefined
                                ? patch.user_type
                                : existingTranslation.title,
                        description:
                            patch.description !== undefined
                                ? patch.description
                                : existingTranslation.description,
                    },
                );
            } else {
                await this.contentRevisionTranslationRepository.create({
                    revisionId: draft.id!,
                    lang,
                    title: patch.user_type ?? '',
                    description: patch.description ?? '',
                    i18nExtra: {},
                    tStatus: 'DRAFT',
                });
            }
        }
    }

    async replaceById(id: number, body: UserTypeLegacy): Promise<void> {
        const item = await this.findItemByLegacyIdOrFail(id);
        const draft = await this.findOrCreateDraft(item);

        const sourceLang = body.sourceLang ?? draft.sourceLang;

        await this.contentRevisionRepository.updateById(draft.id!, {
            sourceLang,
            dataExtra: body.dataExtra ?? {},
        });

        const existingTranslation =
            await this.contentRevisionTranslationRepository.findOne({
                where: {
                    revisionId: draft.id!,
                    lang: sourceLang,
                },
            });

        if (existingTranslation) {
            await this.contentRevisionTranslationRepository.updateById(
                existingTranslation.id!,
                {
                    title: body.user_type ?? '',
                    description: body.description ?? '',
                    i18nExtra: {},
                    tStatus: 'DRAFT',
                },
            );
        } else {
            await this.contentRevisionTranslationRepository.create({
                revisionId: draft.id!,
                lang: sourceLang,
                title: body.user_type ?? '',
                description: body.description ?? '',
                i18nExtra: {},
                tStatus: 'DRAFT',
            });
        }
    }

    async deleteById(id: number): Promise<void> {
        const item = await this.findItemByLegacyIdOrFail(id);
        await this.contentItemRepository.deleteById(item.id!);
    }

    async getTranslatedForFrontend(
        defaultLang = 'en',
        currentLang = 'en',
    ): Promise<Array<Record<string, unknown>>> {
        const items = await this.contentItemRepository.find({
            where: {
                typeCode: USER_TYPE_CODE,
                publishedRevisionId: { neq: undefined },
            },
        });

        const result: Array<Record<string, unknown>> = [];

        for (const item of items) {
            if (!item.publishedRevisionId) continue;

            const currentTranslation =
                await this.contentRevisionTranslationRepository.findOne({
                    where: {
                        revisionId: item.publishedRevisionId,
                        lang: currentLang,
                        tStatus: 'PUBLISHED',
                    },
                });

            const fallbackTranslation =
                currentTranslation ??
                (await this.contentRevisionTranslationRepository.findOne({
                    where: {
                        revisionId: item.publishedRevisionId,
                        lang: defaultLang,
                        tStatus: 'PUBLISHED',
                    },
                }));

            if (!fallbackTranslation) continue;

            result.push({
                id: Number(item.externalKey),
                user_type: fallbackTranslation.title,
                description: fallbackTranslation.description,
                lang: fallbackTranslation.lang,
            });
        }

        return result;
    }

    async publish(id: number): Promise<void> {
        const item = await this.findItemByLegacyIdOrFail(id);

        const approvedRevision = await this.contentRevisionRepository.findOne({
            where: {
                itemId: item.id!,
                status: 'APPROVED',
            },
            order: ['revisionNo DESC'],
        });

        if (!approvedRevision) {
            throw new HttpErrors.BadRequest(
                `No APPROVED revision available for USER_TYPE ${id}`,
            );
        }

        await this.contentRevisionRepository.updateById(approvedRevision.id!, {
            status: 'PUBLISHED',
            publishedAt: new Date().toISOString(),
            publishedBy: 'system',
        });

        await this.contentItemRepository.updateById(item.id!, {
            publishedRevisionId: approvedRevision.id!,
        });

        const translations =
            await this.contentRevisionTranslationRepository.find({
                where: {
                    revisionId: approvedRevision.id!,
                    tStatus: 'APPROVED',
                },
            });

        for (const tr of translations) {
            await this.contentRevisionTranslationRepository.updateById(tr.id!, {
                tStatus: 'PUBLISHED',
            });
        }
    }

    protected async nextExternalKey(): Promise<number> {
        const items = await this.contentItemRepository.find({
            where: { typeCode: USER_TYPE_CODE },
            fields: { externalKey: true },
        });
        const max = items.reduce((acc, item) => {
            const n = Number(item.externalKey);
            return Number.isFinite(n) && n > acc ? n : acc;
        }, 0);
        return max + 1;
    }

    protected async findItemByLegacyIdOrFail(id: number): Promise<ContentItem> {
        const item = await this.contentItemRepository.findOne({
            where: {
                typeCode: USER_TYPE_CODE,
                externalKey: String(id),
            },
        });

        if (!item) {
            throw new HttpErrors.NotFound(`USER_TYPE ${id} not found`);
        }

        return item;
    }

    protected async findPreferredRevision(
        itemId: string,
    ): Promise<ContentRevision | null> {
        const draft = await this.contentRevisionRepository.findOne({
            where: { itemId, status: 'DRAFT' },
            order: ['revisionNo DESC'],
        });

        if (draft) return draft;

        const published = await this.contentRevisionRepository.findOne({
            where: { itemId, status: 'PUBLISHED' },
            order: ['revisionNo DESC'],
        });

        if (published) return published;

        const approved = await this.contentRevisionRepository.findOne({
            where: { itemId, status: 'APPROVED' },
            order: ['revisionNo DESC'],
        });

        return approved ?? null;
    }

    protected async findOrCreateDraft(
        item: ContentItem,
    ): Promise<ContentRevision> {
        const existingDraft = await this.contentRevisionRepository.findOne({
            where: {
                itemId: item.id!,
                status: 'DRAFT',
            },
        });

        if (existingDraft) {
            return existingDraft;
        }

        const latestRevision = await this.contentRevisionRepository.findOne({
            where: { itemId: item.id! },
            order: ['revisionNo DESC'],
        });

        const nextRevisionNo = latestRevision ? latestRevision.revisionNo + 1 : 1;

        const newDraft = await this.contentRevisionRepository.create({
            itemId: item.id!,
            revisionNo: nextRevisionNo,
            status: 'DRAFT',
            sourceLang: latestRevision?.sourceLang ?? 'en',
            dataExtra: latestRevision?.dataExtra ?? {},
        });

        if (latestRevision) {
            const translations =
                await this.contentRevisionTranslationRepository.find({
                    where: { revisionId: latestRevision.id! },
                });

            for (const tr of translations) {
                await this.contentRevisionTranslationRepository.create({
                    revisionId: newDraft.id!,
                    lang: tr.lang,
                    title: tr.title,
                    description: tr.description,
                    i18nExtra: tr.i18nExtra ?? {},
                    tStatus: tr.lang === newDraft.sourceLang ? 'DRAFT' : 'STALE',
                });
            }
        }

        return newDraft;
    }

    protected toLegacyDto(
        item: ContentItem,
        revision: ContentRevision,
        translation?: Partial<ContentRevisionTranslation>,
    ): UserTypeLegacy {
        return Object.assign(new UserTypeLegacy(), {
            id: Number(item.externalKey),
            user_type: translation?.title ?? '',
            description: translation?.description ?? '',
            status: revision.status,
            sourceLang: revision.sourceLang,
            dataExtra: revision.dataExtra ?? {},
        });
    }
}