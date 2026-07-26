import {z} from 'zod';

import {LedgerValidationError} from './errors.js';
import type {LedgerIssue, LedgerOption, LedgerSettings} from './types.js';

const persistedValueSchema = z
  .string()
  .min(1, {message: 'Value must not be empty'})
  .refine((value) => value.trim() === value, {
    message: 'Value must not have leading or trailing whitespace',
  });

const optionSchema = z.strictObject({
  value: persistedValueSchema,
  status: z.enum(['active', 'archived']),
});

const settingsFields = {
  schema_version: z.literal(1),
  currency: z.literal('TWD'),
  active_semester: persistedValueSchema,
  default_officer: persistedValueSchema,
  semesters: z.array(optionSchema),
  categories: z.array(optionSchema),
  officers: z.array(optionSchema),
};

const settingsV1Schema = z.strictObject(settingsFields);

const settingsV2Schema = z.strictObject({
  ...settingsFields,
  schema_version: z.literal(2),
  locked_semesters: z.array(persistedValueSchema),
});

type OptionField = 'semesters' | 'categories' | 'officers';

type ReferenceField = 'active_semester' | 'default_officer';

type PersistedSettings =
  | z.infer<typeof settingsV1Schema>
  | z.infer<typeof settingsV2Schema>;

interface InspectableOption {
  value: string;
  status: unknown;
}

function inspectOption(value: unknown): InspectableOption | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const option = value as Record<string, unknown>;
  return typeof option.value === 'string'
    ? {value: option.value, status: option.status}
    : null;
}

function addDuplicateIssues(
  issues: LedgerIssue[],
  field: OptionField,
  value: unknown,
): void {
  if (!Array.isArray(value)) return;

  const seen = new Set<string>();

  value.forEach((candidate, index) => {
    const option = inspectOption(candidate);
    if (option === null) return;

    if (seen.has(option.value)) {
      issues.push(
        ledgerIssue(
          `${field}.${index}.value`,
          option.value,
          'Option values must be unique',
        ),
      );
    }
    seen.add(option.value);
  });
}

function addActiveReferenceIssue(
  issues: LedgerIssue[],
  field: ReferenceField,
  reference: unknown,
  options: unknown,
): void {
  if (typeof reference !== 'string' || !Array.isArray(options)) return;

  const hasActiveOption = options.some((candidate) => {
    const option = inspectOption(candidate);
    return option?.value === reference && option.status === 'active';
  });

  if (!hasActiveOption) {
    issues.push(
      ledgerIssue(field, reference, 'Value must reference an active option'),
    );
  }
}

function addLockedSemesterIssues(
  issues: LedgerIssue[],
  lockedSemesters: unknown,
  semesters: unknown,
  activeSemester: unknown,
): void {
  if (!Array.isArray(lockedSemesters)) return;

  const seen = new Set<string>();

  lockedSemesters.forEach((lockedSemester, index) => {
    if (typeof lockedSemester !== 'string') return;

    const field = `locked_semesters.${index}`;
    if (seen.has(lockedSemester)) {
      issues.push(
        ledgerIssue(field, lockedSemester, 'Locked semesters must be unique'),
      );
    }
    seen.add(lockedSemester);

    const hasActiveSemester =
      Array.isArray(semesters) &&
      semesters.some((candidate) => {
        const option = inspectOption(candidate);
        return option?.value === lockedSemester && option.status === 'active';
      });
    if (!hasActiveSemester) {
      issues.push(
        ledgerIssue(
          field,
          lockedSemester,
          'Value must reference an active semester',
        ),
      );
    }
    if (lockedSemester === activeSemester) {
      issues.push(
        ledgerIssue(
          'active_semester',
          activeSemester,
          'Active semester cannot be locked',
        ),
      );
    }
  });
}

function semanticIssues(value: unknown): LedgerIssue[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }

  const settings = value as Record<string, unknown>;
  const issues: LedgerIssue[] = [];

  addDuplicateIssues(issues, 'semesters', settings.semesters);
  addDuplicateIssues(issues, 'categories', settings.categories);
  addDuplicateIssues(issues, 'officers', settings.officers);
  addActiveReferenceIssue(
    issues,
    'active_semester',
    settings.active_semester,
    settings.semesters,
  );
  addActiveReferenceIssue(
    issues,
    'default_officer',
    settings.default_officer,
    settings.officers,
  );
  addLockedSemesterIssues(
    issues,
    settings.locked_semesters,
    settings.semesters,
    settings.active_semester,
  );

  return issues;
}

function schemaFor(
  value: unknown,
): typeof settingsV1Schema | typeof settingsV2Schema {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const schemaVersion = (value as Record<string, unknown>).schema_version;
    if (schemaVersion === 1) return settingsV1Schema;
  }

  return settingsV2Schema;
}

function normalizeSettings(value: PersistedSettings): LedgerSettings {
  if (value.schema_version === 1) {
    return {
      ...value,
      schema_version: 2,
      locked_semesters: [],
    };
  }

  return value;
}

function dottedField(path: PropertyKey[]): string {
  return path.length === 0 ? '$' : path.map(String).join('.');
}

function valueAtPath(value: unknown, path: PropertyKey[]): unknown {
  let current = value;

  for (const segment of path) {
    if (
      current === null ||
      typeof current !== 'object' ||
      !Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      return undefined;
    }
    current = (current as Record<PropertyKey, unknown>)[segment];
  }

  return current;
}

function ledgerIssue(
  field: string,
  value: unknown,
  message: string,
): LedgerIssue {
  return {
    source: 'settings',
    field,
    ...(value === undefined ? {} : {value}),
    message,
  };
}

function toLedgerIssues(error: z.ZodError, value: unknown): LedgerIssue[] {
  return error.issues.flatMap((issue) => {
    if (issue.code === 'unrecognized_keys') {
      return issue.keys.map((key) => {
        const path = [...issue.path, key];
        return ledgerIssue(
          dottedField(path),
          valueAtPath(value, path),
          'Unknown settings key',
        );
      });
    }

    return [
      ledgerIssue(
        dottedField(issue.path),
        valueAtPath(value, issue.path),
        issue.message,
      ),
    ];
  });
}

function deduplicateIssues(issues: LedgerIssue[]): LedgerIssue[] {
  const seen = new Set<string>();

  return issues.filter((issue) => {
    const key = [issue.source, issue.row ?? '', issue.field, issue.message].join('\u0000');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function validateSettingsValue(value: unknown): LedgerSettings {
  let result:
    | ReturnType<typeof settingsV1Schema.safeParse>
    | ReturnType<typeof settingsV2Schema.safeParse>;
  let issues: LedgerIssue[];

  try {
    result = schemaFor(value).safeParse(value);
    const semanticValue = result.success ? normalizeSettings(result.data) : value;
    issues = deduplicateIssues([
      ...(result.success ? [] : toLedgerIssues(result.error, value)),
      ...semanticIssues(semanticValue),
    ]);
  } catch {
    throw new LedgerValidationError([
      {
        source: 'settings',
        field: '$',
        message: 'Settings could not be inspected',
      },
    ]);
  }

  if (!result.success || issues.length > 0) {
    throw new LedgerValidationError(issues);
  }

  return normalizeSettings(result.data);
}

export function parseSettingsText(text: string): LedgerSettings {
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch {
    throw new LedgerValidationError([
      {source: 'settings', field: 'json', message: 'Malformed JSON'},
    ]);
  }

  return validateSettingsValue(value);
}

export function serializeSettings(settings: LedgerSettings): string {
  return `${JSON.stringify(validateSettingsValue(settings), null, 2)}\n`;
}

export function activeValues(options: LedgerOption[]): string[] {
  return options
    .filter((option) => option.status === 'active')
    .map((option) => option.value);
}
