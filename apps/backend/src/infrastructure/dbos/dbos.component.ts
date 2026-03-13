import { Component, createBindingFromClass } from '@loopback/core';
import { DBOS_CONFIG } from './dbos.config';
import { DbosLifeCycleObserver } from './dbos.lifecycle';

export class DbosComponent implements Component {
    bindings = [createBindingFromClass(DbosLifeCycleObserver)];

    // DBOS_CONFIG must be bound by the caller (application.ts) before this
    // component is registered so that DbosLifeCycleObserver can inject it.
}