import { describe, expect, it } from 'vitest';
import {
  configurationName,
  configurationPurpose,
  experimentName,
  experimentStage,
  groupName,
  isDevelopmentExperiment,
  taskName,
} from './names.js';

describe('plain-language presentation names', () => {
  it('uses the same version label wherever a saved configuration appears', () => {
    const config = {
      id: '1a381370-08c5-4fbb-b822-f2678ec1d588',
      name: 'Original name',
      description: 'Original description',
    };
    expect(configurationName(config)).toBe('V4 · Save and recall customer preferences');
    expect(configurationPurpose(config)).toContain('contact-specific CRM notes');
    expect(config.name).toBe('Original name');
  });
  it('keeps original and corrected scores at the same experiment stage', () => {
    const original = { id: 'a14ded53-7c33-4f61-addf-931c1bd9ebf0', name: 'Original' };
    const correction = { id: '76190125-ae2f-4db2-ae07-7dc99a15cf66', name: 'Correction' };
    expect(experimentName(original)).toBe(experimentName(correction));
    expect(experimentStage(correction)).toBe(4);
    expect(original.name).toBe('Original');
  });
  it('uses readable action names without changing scenario definitions', () => {
    expect(taskName({ key: 'symptom-routing', title: 'Original title' })).toBe(
      'Refer gum swelling to a clinician instead of booking',
    );
    expect(groupName('memory')).toBe('Returning customers');
  });
  it('preserves user-created names and unknown groups', () => {
    const custom = { id: 'custom', name: 'My test', description: 'My description' };
    expect(configurationName(custom)).toBe('My test');
    expect(configurationPurpose(custom)).toBe('My description');
    expect(experimentName(custom)).toBe('My test');
    expect(taskName({ key: 'custom', title: 'My scenario' })).toBe('My scenario');
    expect(groupName('custom')).toBe('custom');
    expect(isDevelopmentExperiment(custom)).toBe(false);
  });
});
