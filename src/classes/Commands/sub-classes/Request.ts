import SteamID from 'steamid';
import SKU from 'tf2-sku-2';
import pluralize from 'pluralize';
import dayjs from 'dayjs';
import sleepasync from 'sleep-async';
import Currencies from 'tf2-currencies-2';
import { removeLinkProtocol, getItemFromParams, testSKU, fixSKU } from '../functions/utils';
import Bot from '../../Bot';
import CommandParser from '../../CommandParser';
import log from '../../../lib/logger';
import { fixItem } from '../../../lib/items';
import { UnknownDictionary } from '../../../types/common';
import Pricer, { GetPriceFn, GetSnapshotsFn, RequestCheckFn, RequestCheckResponse } from '../../Pricer';

export default class RequestCommands {
    private getSnapshots: GetSnapshotsFn;

    private requestCheck: RequestCheckFn;

    private getPrice: GetPriceFn;

    constructor(private readonly bot: Bot, private priceSource: Pricer) {
        this.bot = bot;

        this.getSnapshots = this.priceSource.getSnapshots.bind(this.priceSource);
        this.requestCheck = this.priceSource.requestCheck.bind(this.priceSource);
        this.getPrice = this.priceSource.getPrice.bind(this.priceSource);
    }

    async getSnapshotsCommand(steamID: SteamID, message: string): Promise<void> {
        if (this.bot.options.customPricerUrl !== '' && this.bot.options.customPricerApiToken !== '') {
            return this.bot.sendMessage(steamID, '❌ This command is disabled for custom pricer.');
        }

        const params = CommandParser.parseParams(CommandParser.removeCommand(removeLinkProtocol(message)));
        if (params.sku === undefined) {
            const item = getItemFromParams(steamID, params, this.bot);

            if (item === null) {
                return;
            }

            params.sku = SKU.fromObject(item);
        } else {
            params.sku = SKU.fromObject(fixItem(SKU.fromString(params.sku), this.bot.schema));
        }

        params.sku = fixSKU(params.sku);

        const name = this.bot.schema.getName(SKU.fromString(params.sku));
        try {
            const salesData = await this.getSnapshots(params.sku, 'bptf');
            if (!salesData) {
                return this.bot.sendMessage(
                    steamID,
                    `❌ No recorded snapshots found for ${name === null ? (params.sku as string) : name}.`
                );
            }

            if (salesData.sales.length === 0) {
                return this.bot.sendMessage(
                    steamID,
                    `❌ No recorded snapshots found for ${name === null ? (params.sku as string) : name}.`
                );
            }

            const sales: Sales[] = [];
            salesData.sales.forEach(sale =>
                sales.push({
                    seller: 'https://backpack.tf/profiles/' + sale.steamid,
                    itemHistory: 'https://backpack.tf/item/' + sale.id.replace('440_', ''),
                    keys: sale.currencies.keys,
                    metal: sale.currencies.metal,
                    date: sale.time
                })
            );
            sales.sort((a, b) => b.date - a.date);

            let left = 0;
            const salesList: string[] = [];
            const salesListCount = salesList.length;
            const salesCount = sales.length;

            for (let i = 0; i < salesCount; i++) {
                if (salesListCount > 40) {
                    left += 1;
                } else {
                    const sale = sales[i];
                    salesList.push(
                        `Listed #${i + 1}-----\n• Date: ${dayjs.unix(sale.date).utc().toString()}\n• Item: ${
                            sale.itemHistory
                        }\n• Seller: ${sale.seller}\n• Was selling for: ${sale.keys > 0 ? `${sale.keys} keys,` : ''} ${
                            sale.metal
                        } ref`
                    );
                }
            }

            let reply = `🔎 Recorded removed sell listings from backpack.tf\n\nItem name: ${
                salesData.name
            }\n\n-----${salesList.join('\n\n-----')}`;
            if (left > 0) {
                reply += `,\n\nand ${left} other ${pluralize('sale', left)}`;
            }

            this.bot.sendMessage(steamID, reply);
        } catch (err) {
            return this.bot.sendMessage(
                steamID,
                `❌ Error getting sell snapshots for ${name === null ? (params.sku as string) : name}: ${
                    (err as ErrorRequest).body && (err as ErrorRequest).body.message
                        ? (err as ErrorRequest).body.message
                        : (err as ErrorRequest).message
                }`
            );
        }
    }

    pricecheckCommand(steamID: SteamID, message: string): void {
        const params = CommandParser.parseParams(CommandParser.removeCommand(removeLinkProtocol(message)));
        if (params.sku !== undefined && !testSKU(params.sku as string)) {
            return this.bot.sendMessage(steamID, `❌ "sku" should not be empty or wrong format.`);
        }

        if (params.sku === undefined) {
            const item = getItemFromParams(steamID, params, this.bot);
            if (item === null) {
                return;
            }

            params.sku = SKU.fromObject(item);
        } else {
            params.sku = SKU.fromObject(fixItem(SKU.fromString(params.sku), this.bot.schema));
        }

        params.sku = fixSKU(params.sku);

        const name = this.bot.schema.getName(SKU.fromString(params.sku), false);
        void this.requestCheck(params.sku, 'bptf').asCallback((err: ErrorRequest, body: RequestCheckResponse) => {
            if (err) {
                return this.bot.sendMessage(
                    steamID,
                    `❌ Error while requesting price check: ${
                        err.body && err.body.message ? err.body.message : err.message
                    }`
                );
            }

            if (!body) {
                this.bot.sendMessage(steamID, '❌ Error while requesting price check (returned null/undefined)');
            } else {
                this.bot.sendMessage(
                    steamID,
                    `⌛ Price check requested for ${
                        body.name.includes('War Paint') ||
                        body.name.includes('Mann Co. Supply Crate Series #') ||
                        body.name.includes('Salvaged Mann Co. Supply Crate #')
                            ? name
                            : body.name
                    }, the item will be checked.`
                );
            }
        });
    }

    pricecheckAllCommand(steamID: SteamID): void {
        if (Pricecheck.isRunning(steamID)) {
            return this.bot.sendMessage(steamID, "❌ Pricecheck is still running. Please wait until it's completed.");
        }

        const pricelist = this.bot.pricelist.getPrices;

        const total = pricelist.length;
        const totalTime = total * 2 * 1000;
        const aSecond = 1 * 1000;
        const aMin = 1 * 60 * 1000;
        const anHour = 1 * 60 * 60 * 1000;
        this.bot.sendMessage(
            steamID,
            `⌛ Price check requested for ${total} items. It will be completed in approximately ${
                totalTime < aMin
                    ? `${Math.round(totalTime / aSecond)} seconds.`
                    : totalTime < anHour
                    ? `${Math.round(totalTime / aMin)} minutes.`
                    : `${Math.round(totalTime / anHour)} hours.`
            } (about 2 seconds for each item).`
        );

        const skus = pricelist.map(entry => entry.sku);

        const pricecheck = new Pricecheck(this.bot, this.priceSource, steamID);
        for (const sku of skus) {
            pricecheck.enqueue(sku);
        }

        Pricecheck.addJob(pricecheck);
        void pricecheck.executeCheck();
    }

    async checkCommand(steamID: SteamID, message: string): Promise<void> {
        const params = CommandParser.parseParams(CommandParser.removeCommand(removeLinkProtocol(message)));
        if (params.sku !== undefined && !testSKU(params.sku as string)) {
            return this.bot.sendMessage(steamID, `❌ "sku" should not be empty or wrong format.`);
        }

        if (params.sku === undefined) {
            const item = getItemFromParams(steamID, params, this.bot);
            if (item === null) {
                return;
            }

            params.sku = SKU.fromObject(item);
        } else {
            params.sku = SKU.fromObject(fixItem(SKU.fromString(params.sku), this.bot.schema));
        }

        params.sku = fixSKU(params.sku);

        const customUrl = this.bot.options.customPricerUrl;
        const name = this.bot.schema.getName(SKU.fromString(params.sku));
        try {
            const price = await this.getPrice(params.sku, 'bptf');
            const currBuy = new Currencies(price.buy);
            const currSell = new Currencies(price.sell);

            this.bot.sendMessage(
                steamID,
                `🔎 ${name}:\n• Buy  : ${currBuy.toString()}\n• Sell : ${currSell.toString()}\n\n${
                    customUrl ? `Link: ${customUrl}` : 'Prices.TF: https://prices.tf'
                }/items/${params.sku as string}`
            );
        } catch (err) {
            return this.bot.sendMessage(
                steamID,
                `Error getting price for ${name === null ? (params.sku as string) : name}: ${
                    (err as ErrorRequest).body && (err as ErrorRequest).body.message
                        ? (err as ErrorRequest).body.message
                        : (err as ErrorRequest).message
                }`
            );
        }
    }
}

class Pricecheck {
    // reference: https://www.youtube.com/watch?v=bK7I79hcm08

    private static pricecheck: UnknownDictionary<Pricecheck> = {};

    private requestCheck: RequestCheckFn;

    private collection: string[] = [];

    private submitted = 0;

    private success = 0;

    private failed = 0;

    constructor(private readonly bot: Bot, private priceSource: Pricer, private steamID: SteamID) {
        this.bot = bot;
        this.requestCheck = this.priceSource.requestCheck.bind(this.priceSource);
    }

    enqueue(sku: string): void {
        this.collection.push(sku);
    }

    async executeCheck(): Promise<void> {
        await sleepasync().Promise.sleep(2 * 1000);

        void this.requestCheck(this.front, 'bptf').asCallback(err => {
            if (err) {
                this.submitted++;
                this.failed++;
                log.warn(`pricecheck failed for ${this.front}: ${JSON.stringify(err)}`);
                log.debug(
                    `pricecheck for ${this.front} failed, status: ${this.submitted}/${this.size}, ${this.success} success, ${this.failed} failed.`
                );
            } else {
                this.submitted++;
                this.success++;
                log.debug(
                    `pricecheck for ${this.front} success, status: ${this.submitted}/${this.size}, ${this.success} success, ${this.failed} failed.`
                );
            }

            this.dequeue();
            void this.executeCheck();

            if (this.isEmpty) {
                this.bot.sendMessage(
                    this.steamID,
                    `✅ Successfully pricecheck for all ${this.size} ${pluralize('item', this.size)}!`
                );
                Pricecheck.removeJob(this.steamID);
            }
        });
    }

    dequeue(): void {
        this.collection.shift();
    }

    get front(): string {
        return this.collection[0];
    }

    get size(): number {
        return this.collection.length;
    }

    get isEmpty(): boolean {
        return this.collection.length === 0;
    }

    static addJob(pc: Pricecheck): void {
        this.pricecheck[pc.steamID.getSteamID64()] = pc;
    }

    static isRunning(steamID: SteamID): boolean {
        return this.pricecheck[steamID.getSteamID64()] !== undefined;
    }

    static removeJob(steamID: SteamID): void {
        delete this.pricecheck[steamID.getSteamID64()];
    }
}

interface Sales {
    seller: string;
    itemHistory: string;
    keys: number;
    metal: number;
    date: number;
}

interface ErrorRequest {
    body?: ErrorBody;
    message?: string;
}

interface ErrorBody {
    message: string;
}
