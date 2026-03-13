export function registerDbosWorkflows(): void {
    require('../../workflows/translation/translation.master.workflow');
    require('../../workflows/translation/translation.child.workflow');
    // translation.steps.ts does NOT need to be registered separately —
    // steps are registered when the class that contains them is imported.
}