import { endpointLabel } from '@betterdevtools/core';
import { createMemo, For, Show } from 'solid-js';
import { formatNumber, t } from '../../i18n/index.ts';
import { currentModel, freezeContract, unfreezeContract } from '../../state/discovery.ts';
import IconButton from '../ui/IconButton.tsx';
import { monoClass, sectionTitleClass } from '../ui/styles.ts';

/**
 * Discovery mode learns and points out what is uneven; Validation mode freezes what was learned
 * as the contract and checks every new response against it, so a changed field shows as a
 * regression instead of silently widening the schema.
 */
export default function ContractsTab() {
  const model = () => currentModel();
  const frozen = () => model()?.state.frozen ?? null;
  const conflicts = createMemo(() => {
    const current = model();
    if (!current) return [];
    return current
      .endpoints()
      .flatMap((endpoint) =>
        current.findingsOf(endpoint).map((entry) => ({
          endpoint,
          status: entry.status,
          conflicts: entry.findings.filter((finding) => finding.kind === 'type-conflict'),
        })),
      )
      .filter((entry) => entry.conflicts.length)
      .sort((a, b) => b.conflicts.length - a.conflicts.length);
  });
  const checked = createMemo(() =>
    (model()?.endpoints() ?? []).filter((endpoint) => endpoint.validation.checked > 0).sort((a, b) => b.validation.failed - a.validation.failed),
  );
  const totals = createMemo(() => ({
    checked: checked().reduce((sum, endpoint) => sum + endpoint.validation.checked, 0),
    failed: checked().reduce((sum, endpoint) => sum + endpoint.validation.failed, 0),
  }));

  return (
    <div class="flex h-full min-h-0 flex-col gap-3 overflow-auto p-3">
      <section class="flex flex-wrap items-center gap-3">
        <div class="flex flex-col">
          <h3 class={sectionTitleClass}>{frozen() ? t('discovery.contracts.validationMode') : t('discovery.contracts.discoveryMode')}</h3>
          <p class="max-w-2xl text-fg-2">
            {frozen() ? t('discovery.contracts.validationHint', { date: new Date(frozen()!.at).toLocaleString() }) : t('discovery.contracts.discoveryHint')}
          </p>
        </div>
        <span class="ms-auto">
          <Show
            when={frozen()}
            fallback={
              <IconButton
                icon="check"
                label={t('discovery.contracts.freezeHint')}
                text={t('discovery.contracts.freeze')}
                variant="primary"
                disabled={!model()?.endpoints().length}
                onClick={freezeContract}
              />
            }
          >
            <IconButton icon="undo" label={t('discovery.contracts.unfreezeHint')} text={t('discovery.contracts.unfreeze')} onClick={unfreezeContract} />
          </Show>
        </span>
      </section>

      <Show when={frozen()}>
        <section>
          <h3 class={sectionTitleClass}>{t('discovery.contracts.results')}</h3>
          <p>
            {t('discovery.contracts.summary', { checked: formatNumber(totals().checked), failed: formatNumber(totals().failed) })}
            <Show when={model()!.state.newSinceFreeze.length}>
              {' · '}
              {t('discovery.contracts.newEndpoints', { count: model()!.state.newSinceFreeze.length })}
            </Show>
          </p>
          <Show when={checked().length} fallback={<p class="text-fg-2">{t('discovery.contracts.nothingChecked')}</p>}>
            <ul class="mt-1 flex flex-col gap-2">
              <For each={checked()}>
                {(endpoint) => (
                  <li>
                    <p class={[monoClass, endpoint.validation.failed ? 'text-bad' : 'text-ok']}>
                      {endpoint.validation.failed ? '✗' : '✓'} {endpointLabel(endpoint)}
                      <span class="font-sans text-fg-2">
                        {' — '}
                        {t('discovery.contracts.endpointSummary', { checked: endpoint.validation.checked, failed: endpoint.validation.failed })}
                      </span>
                    </p>
                    <ul class="ms-4">
                      <For each={endpoint.validation.violations}>
                        {(violation) => (
                          <li class="text-bad">
                            <span class={monoClass}>
                              {violation.status} {violation.path}
                            </span>
                            {' — '}
                            {violation.message} ×{violation.count}
                          </li>
                        )}
                      </For>
                    </ul>
                  </li>
                )}
              </For>
            </ul>
          </Show>
          <Show when={model()!.state.newSinceFreeze.length}>
            <h4 class={sectionTitleClass}>{t('discovery.contracts.newTitle')}</h4>
            <ul class={[monoClass, 'flex flex-col gap-0.5']}>
              <For each={model()!.state.newSinceFreeze}>{(key) => <li class="[overflow-wrap:anywhere]">{key}</li>}</For>
            </ul>
          </Show>
        </section>
      </Show>

      <section>
        <h3 class={sectionTitleClass}>{t('discovery.contracts.inconsistencies')}</h3>
        <p class="text-fg-2">{t('discovery.contracts.inconsistenciesHint')}</p>
        <Show when={conflicts().length} fallback={<p class="mt-1">{t('discovery.contracts.noInconsistencies')}</p>}>
          <ul class="mt-1 flex flex-col gap-2">
            <For each={conflicts()}>
              {(entry) => (
                <li>
                  <p class={monoClass}>
                    {endpointLabel(entry.endpoint)} <span class="font-sans text-fg-2">· {entry.status}</span>
                  </p>
                  <ul class="ms-4">
                    <For each={entry.conflicts.slice(0, 10)}>
                      {(finding) => (
                        <li class="text-bad">
                          <span class={monoClass}>{finding.path}</span> — {finding.detail}
                        </li>
                      )}
                    </For>
                  </ul>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>
    </div>
  );
}
