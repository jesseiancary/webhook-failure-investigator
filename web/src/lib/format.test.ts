import { describe, expect, it } from 'vitest';
import { confidenceLevel, formatConfidence, formatCost, formatCount } from './format';

// The confidence bands and cost formatting are credibility surfaces — they must never over-state
// certainty or silently round a real cost to zero.

describe('confidenceLevel', () => {
  it('bands scores conservatively around the 0.75 / 0.4 thresholds', () => {
    expect(confidenceLevel(0.75)).toBe('High');
    expect(confidenceLevel(0.74)).toBe('Medium');
    expect(confidenceLevel(0.4)).toBe('Medium');
    expect(confidenceLevel(0.39)).toBe('Low');
    expect(confidenceLevel(0)).toBe('Low');
  });
});

describe('formatConfidence', () => {
  it('renders a 0–1 score as a whole percentage', () => {
    expect(formatConfidence(0.9234)).toBe('92%');
    expect(formatConfidence(1)).toBe('100%');
  });
});

describe('formatCost', () => {
  it('shows enough precision that a tiny real cost is not rounded to zero', () => {
    expect(formatCost('0.00123')).toBe('$0.0012');
  });

  it('renders an em dash for a null cost and passes unparseable input through', () => {
    expect(formatCost(null)).toBe('—');
    expect(formatCost('not-a-number')).toBe('not-a-number');
  });
});

describe('formatCount', () => {
  it('groups thousands and dashes null', () => {
    expect(formatCount(1234)).toBe('1,234');
    expect(formatCount(null)).toBe('—');
  });
});
