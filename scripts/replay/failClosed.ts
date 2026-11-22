/**
 * The refusal every replay table generator reports with exit code 2 instead of an error
 * (exit 1): inputs it cannot trust (dirty checkout, unknown set, runs of different bars or
 * commits, a quantity it cannot compute). See CONVENTIONS.md#TE-16.
 */
export class FailClosedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'FailClosedError';
    }
}
