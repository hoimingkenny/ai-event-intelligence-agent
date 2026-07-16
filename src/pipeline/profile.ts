export type PipelineProfile = 'analyst-eval' | 'full';

export const DEFAULT_PIPELINE_PROFILE: PipelineProfile = 'analyst-eval';

export type CheapFilterMode = 'gating' | 'advisory';

export function cheapFilterModeForProfile(profile: PipelineProfile): CheapFilterMode {
  return profile === 'analyst-eval' ? 'advisory' : 'gating';
}
