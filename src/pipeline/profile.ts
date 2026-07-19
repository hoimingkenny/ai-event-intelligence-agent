export type PipelineProfile = 'analyst-eval' | 'full' | 'cve-mvp';

export const DEFAULT_PIPELINE_PROFILE: PipelineProfile = 'cve-mvp';

export type CheapFilterMode = 'gating' | 'advisory';

export function cheapFilterModeForProfile(profile: PipelineProfile): CheapFilterMode {
  return profile === 'cve-mvp' || profile === 'analyst-eval' ? 'advisory' : 'gating';
}