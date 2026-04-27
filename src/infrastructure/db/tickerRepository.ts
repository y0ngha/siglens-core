import { eq, inArray, sql } from 'drizzle-orm';
import type { KoreanTickerEntry } from '@/domain/types';
import { assetTranslations, koreanTickers } from './schema';
import type {
    AssetTranslationRecord,
    AssetTranslationRepository,
    KoreanTickerRepository,
    SiglensDatabase,
} from './types';

const koreanTickerColumns = {
    symbol: koreanTickers.symbol,
    name: koreanTickers.name,
    koreanName: koreanTickers.koreanName,
    exchange: koreanTickers.exchange,
    exchangeFullName: koreanTickers.exchangeFullName,
};

const assetTranslationColumns = {
    symbol: assetTranslations.symbol,
    name: assetTranslations.name,
    koreanName: assetTranslations.koreanName,
    fmpSymbol: assetTranslations.fmpSymbol,
};

/**
 * Drizzle ORM implementation of {@link KoreanTickerRepository} backed by Neon
 * PostgreSQL. Reads/writes the `korean_tickers` table.
 *
 * @param db - Drizzle-wrapped Neon database client; obtain via {@link createDatabaseClient}.
 */
export class DrizzleKoreanTickerRepository implements KoreanTickerRepository {
    constructor(private readonly db: SiglensDatabase) {}

    async findAll(): Promise<KoreanTickerEntry[]> {
        return this.db.select(koreanTickerColumns).from(koreanTickers);
    }

    async findBySymbols(
        symbols: readonly string[]
    ): Promise<KoreanTickerEntry[]> {
        if (symbols.length === 0) return [];

        return this.db
            .select(koreanTickerColumns)
            .from(koreanTickers)
            .where(inArray(koreanTickers.symbol, [...symbols]));
    }

    async upsertMany(entries: readonly KoreanTickerEntry[]): Promise<void> {
        if (entries.length === 0) return;

        await this.db
            .insert(koreanTickers)
            .values(entries.map(toKoreanTickerRow))
            .onConflictDoUpdate({
                target: koreanTickers.symbol,
                set: {
                    name: sql.raw(`excluded.${koreanTickers.name.name}`),
                    koreanName: sql.raw(
                        `excluded.${koreanTickers.koreanName.name}`
                    ),
                    exchange: sql.raw(
                        `excluded.${koreanTickers.exchange.name}`
                    ),
                    exchangeFullName: sql.raw(
                        `excluded.${koreanTickers.exchangeFullName.name}`
                    ),
                },
            });
    }
}

/**
 * Drizzle ORM implementation of {@link AssetTranslationRepository} backed by
 * Neon PostgreSQL. Reads/writes the `asset_translations` table.
 *
 * @param db - Drizzle-wrapped Neon database client; obtain via {@link createDatabaseClient}.
 */
export class DrizzleAssetTranslationRepository implements AssetTranslationRepository {
    constructor(private readonly db: SiglensDatabase) {}

    async findBySymbol(symbol: string): Promise<AssetTranslationRecord | null> {
        const [row] = await this.db
            .select(assetTranslationColumns)
            .from(assetTranslations)
            .where(eq(assetTranslations.symbol, symbol))
            .limit(1);

        return row ?? null;
    }

    async upsert(record: AssetTranslationRecord): Promise<void> {
        await this.db
            .insert(assetTranslations)
            .values(record)
            .onConflictDoUpdate({
                target: assetTranslations.symbol,
                set: {
                    name: sql.raw(`excluded.${assetTranslations.name.name}`),
                    koreanName: sql.raw(
                        `excluded.${assetTranslations.koreanName.name}`
                    ),
                    fmpSymbol: sql.raw(
                        `excluded.${assetTranslations.fmpSymbol.name}`
                    ),
                },
            });
    }
}

/** Select DB row fields explicitly so future KoreanTickerEntry fields are not persisted accidentally. */
function toKoreanTickerRow(entry: KoreanTickerEntry): {
    symbol: string;
    name: string;
    koreanName: string;
    exchange: string;
    exchangeFullName: string;
} {
    return {
        symbol: entry.symbol,
        name: entry.name,
        koreanName: entry.koreanName,
        exchange: entry.exchange,
        exchangeFullName: entry.exchangeFullName,
    };
}
