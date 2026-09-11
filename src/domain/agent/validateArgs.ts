import type {
    JsonSchemaObject,
    JsonSchemaProperty,
} from '@/domain/ports/agentProvider';

export interface ArgIssue {
    path: string;
    message: string;
}

export type ValidateArgsResult =
    | { ok: true; value: Record<string, unknown> }
    | { ok: false; issues: ArgIssue[] };

function checkProperty(
    path: string,
    prop: JsonSchemaProperty,
    value: unknown,
    issues: ArgIssue[]
): void {
    switch (prop.type) {
        case 'string':
            if (typeof value !== 'string') {
                issues.push({ path, message: 'expected string' });
                return;
            }
            if (prop.enum !== undefined && !prop.enum.includes(value)) {
                issues.push({
                    path,
                    message: `expected one of ${prop.enum.join('|')}`,
                });
            }
            return;
        case 'boolean':
            if (typeof value !== 'boolean') {
                issues.push({ path, message: 'expected boolean' });
            }
            return;
        case 'number':
        case 'integer': {
            if (typeof value !== 'number' || Number.isNaN(value)) {
                issues.push({ path, message: `expected ${prop.type}` });
                return;
            }
            if (prop.type === 'integer' && !Number.isInteger(value)) {
                issues.push({ path, message: 'expected integer' });
                return;
            }
            if (prop.minimum !== undefined && value < prop.minimum) {
                issues.push({ path, message: `minimum ${prop.minimum}` });
            }
            if (prop.maximum !== undefined && value > prop.maximum) {
                issues.push({ path, message: `maximum ${prop.maximum}` });
            }
            return;
        }
        case 'array': {
            if (!Array.isArray(value)) {
                issues.push({ path, message: 'expected array' });
                return;
            }
            const items = prop.items;
            if (items !== undefined) {
                value.forEach((item, index) =>
                    checkProperty(`${path}[${index}]`, items, item, issues)
                );
            }
            return;
        }
        default: {
            const exhausted: never = prop.type;
            issues.push({ path, message: `unknown type ${String(exhausted)}` });
        }
    }
}

/**
 * Validate model-supplied tool arguments against the tool's JSON Schema
 * subset. Pure; collects every issue instead of failing fast so the model
 * gets one corrective error message.
 *
 * @param schema - The tool's input schema (from `AgentToolSpec.inputSchema`).
 * @param args - The raw, model-supplied argument value to validate.
 * @returns `{ ok: true, value }` with the validated object on success, or
 * `{ ok: false, issues }` listing every schema violation found.
 */
export function validateArgs(
    schema: JsonSchemaObject,
    args: unknown
): ValidateArgsResult {
    if (typeof args !== 'object' || args === null || Array.isArray(args)) {
        return {
            ok: false,
            issues: [{ path: '', message: 'expected object' }],
        };
    }
    const issues: ArgIssue[] = [];
    const record = args as Record<string, unknown>;
    for (const key of schema.required ?? []) {
        if (!(key in record)) issues.push({ path: key, message: 'required' });
    }
    for (const [key, value] of Object.entries(record)) {
        const prop = schema.properties[key];
        if (prop === undefined) {
            issues.push({ path: key, message: 'unknown field' });
            continue;
        }
        if (value === undefined) continue;
        checkProperty(key, prop, value, issues);
    }
    return issues.length === 0
        ? { ok: true, value: record }
        : { ok: false, issues };
}
