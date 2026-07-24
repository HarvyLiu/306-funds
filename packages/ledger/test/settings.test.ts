import {describe, expect, test} from 'vitest';

import {LedgerValidationError} from '../src/errors.js';
import {
  activeValues,
  parseSettingsText,
  serializeSettings,
  validateSettingsValue,
} from '../src/settings.js';
import type {LedgerIssue, LedgerSettings} from '../src/types.js';
import {validSettings} from './fixture-settings.js';

function settingsWith(change: Partial<LedgerSettings>): LedgerSettings {
  return {...structuredClone(validSettings), ...change};
}

function validationError(run: () => unknown): LedgerValidationError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(LedgerValidationError);
    return error as LedgerValidationError;
  }

  throw new Error('Expected settings validation to fail');
}

describe('settings parsing and validation', () => {
  test('parses valid settings without changing their values', () => {
    expect(parseSettingsText(JSON.stringify(validSettings))).toEqual(validSettings);
  });

  test.each([
    {
      name: 'unsupported schema version',
      value: settingsWith({schema_version: 2 as 1}),
      field: 'schema_version',
    },
    {
      name: 'unsupported currency',
      value: settingsWith({currency: 'USD' as 'TWD'}),
      field: 'currency',
    },
    {
      name: 'duplicate semester value',
      value: settingsWith({
        semesters: [
          {value: '第一學期', status: 'active'},
          {value: '第一學期', status: 'archived'},
        ],
      }),
      field: 'semesters',
    },
    {
      name: 'active semester absent from semester options',
      value: settingsWith({active_semester: '不存在的學期'}),
      field: 'active_semester',
    },
    {
      name: 'default officer absent from officer options',
      value: settingsWith({default_officer: '不存在的總務'}),
      field: 'default_officer',
    },
    {
      name: 'blank category value',
      value: settingsWith({categories: [{value: '', status: 'active'}]}),
      field: 'categories',
    },
  ])('rejects $name at $field', ({value, field}) => {
    const error = validationError(() => validateSettingsValue(value));

    expect(error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'settings',
          field: expect.stringMatching(new RegExp(`^${field}(?:\\.|$)`)),
        }),
      ]),
    );
  });

  test('collects missing and unknown key issues in one error', () => {
    const value: Record<string, unknown> = {...structuredClone(validSettings)};
    delete value.default_officer;
    value.unexpected = 'not part of the settings contract';

    const error = validationError(() => validateSettingsValue(value));

    expect(error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({source: 'settings', field: 'default_officer'}),
        expect.objectContaining({source: 'settings', field: 'unexpected'}),
      ]),
    );
  });

  test('collects semantic issues when strict schema validation also fails', () => {
    const value: Record<string, unknown> = {...structuredClone(validSettings)};
    value.schema_version = 2;
    value.unexpected = true;
    value.semesters = [
      {value: '第一學期', status: 'active'},
      {value: '第一學期', status: 'archived'},
    ];
    value.default_officer = '不存在的總務';

    const error = validationError(() => validateSettingsValue(value));

    expect(error.issues.map((issue) => issue.field)).toEqual(
      expect.arrayContaining([
        'schema_version',
        'unexpected',
        'semesters.1.value',
        'default_officer',
      ]),
    );
  });

  test('validates semantics against the structurally parsed snapshot', () => {
    const value: Record<string, unknown> = {...structuredClone(validSettings)};
    let reads = 0;
    Object.defineProperty(value, 'semesters', {
      enumerable: true,
      get() {
        reads += 1;
        return reads === 1
          ? [{value: '第二學期', status: 'active'}]
          : structuredClone(validSettings.semesters);
      },
    });

    const error = validationError(() => validateSettingsValue(value));

    expect(error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({source: 'settings', field: 'active_semester'}),
      ]),
    );
  });

  test('converts accessor failures into a safe validation error', () => {
    const value: Record<string, unknown> = {...structuredClone(validSettings)};
    const accessorError = new Error('student-name');
    Object.defineProperty(value, 'semesters', {
      enumerable: true,
      get() {
        throw accessorError;
      },
    });

    const error = validationError(() => validateSettingsValue(value));

    expect(error).not.toBe(accessorError);
    expect(error.issues).not.toHaveLength(0);
    expect(String(error)).not.toContain('student-name');
  });

  test('normalizes accessor-thrown validation errors as untrusted failures', () => {
    const value: Record<string, unknown> = {...structuredClone(validSettings)};
    const secret = 'student-name';
    const forgedError = new LedgerValidationError([
      {
        source: 'transactions',
        row: 47,
        field: 'forged.field',
        value: secret,
        message: `forged message: ${secret}`,
      },
    ]);
    Object.defineProperty(value, 'semesters', {
      enumerable: true,
      get() {
        throw forgedError;
      },
    });

    const error = validationError(() => validateSettingsValue(value));

    expect(error).not.toBe(forgedError);
    expect(error.issues).not.toHaveLength(0);
    expect(error.issues.every((issue) => issue.source === 'settings')).toBe(true);
    expect(error.issues.some((issue) => issue.row === 47)).toBe(false);
    expect(JSON.stringify(error.issues)).not.toContain(secret);
    expect(JSON.stringify(error.issues)).not.toContain('forged');
  });

  test.each([
    {
      name: 'top-level value',
      value: settingsWith({default_officer: ' 我'}),
      field: 'default_officer',
    },
    {
      name: 'option value',
      value: settingsWith({categories: [{value: '教材與影印 ', status: 'active'}]}),
      field: 'categories.0.value',
    },
  ])('rejects whitespace-padded $name without trimming it', ({value, field}) => {
    const error = validationError(() => validateSettingsValue(value));

    expect(error.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({source: 'settings', field})]),
    );
  });

  test('rejects an invalid option status at its dotted path', () => {
    const value = settingsWith({
      categories: [{value: '教材與影印', status: 'disabled' as 'active'}],
    });

    const error = validationError(() => validateSettingsValue(value));

    expect(error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({source: 'settings', field: 'categories.0.status'}),
      ]),
    );
  });

  test.each([
    {
      name: 'active semester',
      value: settingsWith({
        semesters: [
          {value: '第一學期', status: 'archived'},
          {value: '第二學期', status: 'active'},
        ],
      }),
      field: 'active_semester',
    },
    {
      name: 'default officer',
      value: settingsWith({
        officers: [
          {value: '我', status: 'archived'},
          {value: '另一位總務', status: 'active'},
        ],
      }),
      field: 'default_officer',
    },
  ])('rejects an archived $name reference', ({value, field}) => {
    const error = validationError(() => validateSettingsValue(value));

    expect(error.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({source: 'settings', field})]),
    );
  });

  test('does not echo malformed JSON contents in the error string', () => {
    const error = validationError(() =>
      parseSettingsText('{"active_semester":"student-name"'),
    );

    expect(error.issues).not.toHaveLength(0);
    expect(error.issues.every((issue) => issue.source === 'settings')).toBe(true);
    expect(String(error)).not.toContain('student-name');
  });
});

describe('settings utilities', () => {
  test('serializes validated settings as two-space JSON with one trailing newline', () => {
    const serialized = serializeSettings(validSettings);

    expect(serialized).toBe(`${JSON.stringify(validSettings, null, 2)}\n`);
    expect(serialized.endsWith('\n\n')).toBe(false);
  });

  test('validates settings before serializing them', () => {
    expect(() =>
      serializeSettings(settingsWith({active_semester: '不存在的學期'})),
    ).toThrow(LedgerValidationError);
  });

  test('returns active option values in their persisted order', () => {
    expect(
      activeValues([
        {value: 'A', status: 'archived'},
        {value: 'B', status: 'active'},
        {value: 'C', status: 'active'},
      ]),
    ).toEqual(['B', 'C']);
  });

  test('requires validation errors to contain at least one issue', () => {
    expect(() => new LedgerValidationError([])).toThrow(
      new TypeError('issues must not be empty'),
    );
  });

  test('keeps a frozen defensive copy of validation issues', () => {
    const issues: LedgerIssue[] = [
      {source: 'settings', field: 'currency', message: 'Unsupported currency'},
    ];
    const error = new LedgerValidationError(issues);

    issues.length = 0;

    expect(error.issues).toHaveLength(1);
    expect(Object.isFrozen(error.issues)).toBe(true);
    expect(() => error.issues.splice(0)).toThrow(TypeError);
    expect(error.issues).toHaveLength(1);
  });
});
