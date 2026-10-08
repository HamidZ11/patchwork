import { describe, expect, it } from 'vitest';
import { ExplanationModelError, parseFollowUpAnswer } from '../openai.js';
import {
  MAX_FOLLOW_UP_ANSWER_LENGTH,
  MAX_FOLLOW_UP_HISTORY,
  MAX_FOLLOW_UP_QUESTION_LENGTH,
  followUpRequestSchema,
} from '../types.js';

const turn = { question: 'Which files?', answer: 'src/billing.ts line 5.' };

describe('followUpRequestSchema', () => {
  it('accepts a question with no history, defaulting the history to empty', () => {
    expect(followUpRequestSchema.parse({ question: '  Which files?  ' })).toEqual({
      question: 'Which files?',
      history: [],
    });
  });

  it('rejects an empty or over-long question', () => {
    expect(followUpRequestSchema.safeParse({ question: '   ' }).success).toBe(false);
    expect(
      followUpRequestSchema.safeParse({ question: 'x'.repeat(MAX_FOLLOW_UP_QUESTION_LENGTH + 1) })
        .success,
    ).toBe(false);
  });

  it('bounds the history the caller may send', () => {
    const atLimit = Array.from({ length: MAX_FOLLOW_UP_HISTORY }, () => turn);
    expect(followUpRequestSchema.safeParse({ question: 'q', history: atLimit }).success).toBe(true);
    expect(
      followUpRequestSchema.safeParse({ question: 'q', history: [...atLimit, turn] }).success,
    ).toBe(false);
    expect(
      followUpRequestSchema.safeParse({
        question: 'q',
        history: [{ question: 'q', answer: 'a'.repeat(MAX_FOLLOW_UP_ANSWER_LENGTH + 1) }],
      }).success,
    ).toBe(false);
  });

  it('ignores anything but the question and history', () => {
    const parsed = followUpRequestSchema.parse({
      question: 'q',
      history: [],
      facts: { verdict: 'NOT_AFFECTED' },
    });
    expect(Object.keys(parsed).sort()).toEqual(['history', 'question']);
  });
});

describe('parseFollowUpAnswer', () => {
  it('accepts a well-formed structured answer, trimmed', () => {
    expect(parseFollowUpAnswer(JSON.stringify({ answer: '  Two places.  ' }))).toBe('Two places.');
  });

  it('rejects malformed, empty, missing and over-long answers as invalid output', () => {
    for (const raw of [
      '{"answer": "trunc',
      JSON.stringify({ answer: '' }),
      JSON.stringify({ reply: 'wrong key' }),
      JSON.stringify({ answer: 'a'.repeat(MAX_FOLLOW_UP_ANSWER_LENGTH + 1) }),
    ]) {
      expect(() => parseFollowUpAnswer(raw)).toThrowError(ExplanationModelError);
      try {
        parseFollowUpAnswer(raw);
      } catch (error) {
        expect((error as ExplanationModelError).kind).toBe('invalid_output');
      }
    }
  });
});
