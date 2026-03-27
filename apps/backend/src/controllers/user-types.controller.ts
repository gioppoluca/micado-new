import {
    CountSchema,
    Filter,
    FilterExcludingWhere,
    Where,
} from '@loopback/repository';
import {
    del,
    get,
    getModelSchemaRef,
    param,
    patch,
    post,
    put,
    requestBody,
} from '@loopback/rest';
import { authenticate } from '@loopback/authentication';
import { UserTypeLegacy } from '../models';
import { inject, service } from '@loopback/core';
import { UserTypeFacadeService } from '../services/user-type-facade.service';

@authenticate('keycloak')
export class UserTypesController {
    constructor(
        @service(UserTypeFacadeService)
        protected userTypeFacadeService: UserTypeFacadeService,
    ) { }

    @post('/user-types', {
        responses: {
            '200': {
                description: 'UserTypes model instance',
                content: {
                    'application/json': {
                        schema: getModelSchemaRef(UserTypeLegacy),
                    },
                },
            },
        },
    })
    async create(
        @requestBody({
            content: {
                'application/json': {
                    schema: getModelSchemaRef(UserTypeLegacy, {
                        title: 'NewUserTypes',
                        exclude: ['id'],
                    }),
                },
            },
        })
        userTypes: Omit<UserTypeLegacy, 'id' | 'status'>,
    ): Promise<UserTypeLegacy> {
        return this.userTypeFacadeService.create(userTypes);
    }

    @get('/user-types/count', {
        responses: {
            '200': {
                description: 'UserTypes model count',
                content: {
                    'application/json': {
                        schema: CountSchema,
                    },
                },
            },
        },
    })
    async count(
        @param.where(UserTypeLegacy) where?: Where<UserTypeLegacy>,
    ): Promise<{ count: number }> {
        return this.userTypeFacadeService.count(where as Record<string, unknown>);
    }

    @get('/user-types', {
        responses: {
            '200': {
                description: 'Array of UserTypes model instances',
                content: {
                    'application/json': {
                        schema: {
                            type: 'array',
                            items: getModelSchemaRef(UserTypeLegacy),
                        },
                    },
                },
            },
        },
    })
    async find(
        @param.filter(UserTypeLegacy) filter?: Filter<UserTypeLegacy>,
    ): Promise<UserTypeLegacy[]> {
        return this.userTypeFacadeService.find(filter);
    }

    @get('/user-types/{id}', {
        responses: {
            '200': {
                description: 'UserTypes model instance',
                content: {
                    'application/json': {
                        schema: getModelSchemaRef(UserTypeLegacy),
                    },
                },
            },
        },
    })
    async findById(
        @param.path.number('id') id: number,
        @param.filter(UserTypeLegacy, { exclude: 'where' })
        _filter?: FilterExcludingWhere<UserTypeLegacy>,
    ): Promise<UserTypeLegacy> {
        return this.userTypeFacadeService.findById(id);
    }

    @patch('/user-types/{id}', {
        responses: {
            '204': {
                description: 'UserTypes PATCH success',
            },
        },
    })
    async updateById(
        @param.path.number('id') id: number,
        @requestBody({
            content: {
                'application/json': {
                    schema: getModelSchemaRef(UserTypeLegacy, { partial: true }),
                },
            },
        })
        userTypes: Partial<UserTypeLegacy>,
    ): Promise<void> {
        await this.userTypeFacadeService.updateById(id, userTypes);
    }

    @put('/user-types/{id}', {
        responses: {
            '204': {
                description: 'UserTypes PUT success',
            },
        },
    })
    async replaceById(
        @param.path.number('id') id: number,
        @requestBody()
        userTypes: UserTypeLegacy,
    ): Promise<void> {
        await this.userTypeFacadeService.replaceById(id, userTypes);
    }

    @del('/user-types/{id}', {
        responses: {
            '204': {
                description: 'UserTypes DELETE success',
            },
        },
    })
    async deleteById(
        @param.path.number('id') id: number,
    ): Promise<void> {
        await this.userTypeFacadeService.deleteById(id);
    }

    @get('/user-types-migrant', {
        responses: {
            '200': {
                description: 'user-types GET for the frontend',
                content: {
                    'application/json': {
                        schema: {
                            type: 'array',
                            items: {
                                type: 'object',
                            },
                        },
                    },
                },
            },
        },
    })
    async translatedunion(
        @param.query.string('defaultlang') defaultlang = 'en',
        @param.query.string('currentlang') currentlang = 'en',
    ): Promise<Array<Record<string, unknown>>> {
        return this.userTypeFacadeService.getTranslatedForFrontend(
            defaultlang,
            currentlang,
        );
    }

    @get('/user-types/to-production', {
        responses: {
            '200': {
                description: 'process GET for the frontend',
            },
        },
    })
    async publish(
        @param.query.number('id') id: number,
    ): Promise<void> {
        await this.userTypeFacadeService.publish(id);
    }
}