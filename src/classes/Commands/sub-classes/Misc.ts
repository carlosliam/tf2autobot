import SteamID from 'steamid';
import SKU from 'tf2-sku-2';
import pluralize from 'pluralize';
import sleepasync from 'sleep-async';
import Bot from '../../Bot';
import { Discord, Stock } from '../../Options';
import { pure, timeNow, uptime } from '../../../lib/tools/export';

type Misc = 'time' | 'uptime' | 'pure' | 'rate' | 'owner' | 'discord' | 'stock';
type CraftUncraft = 'craftweapon' | 'uncraftweapon';

export default class MiscCommands {
    constructor(private readonly bot: Bot) {
        this.bot = bot;
    }

    async miscCommand(steamID: SteamID, command: Misc): Promise<void> {
        const opt = this.bot.options.commands[command];
        if (!opt.enable) {
            if (!this.bot.isAdmin(steamID)) {
                const custom = opt.customReply.disabled;
                return this.bot.sendMessage(steamID, custom ? custom : '❌ This command is disabled by the owner.');
            }
        }

        const custom = opt.customReply.reply;
        if (command === 'time') {
            const timeWithEmojis = timeNow(this.bot.options);
            await this.bot.sendMessage(
                steamID,
                custom
                    ? custom
                          .replace(/%emoji%/g, timeWithEmojis.emoji)
                          .replace(/%time%/g, timeWithEmojis.time)
                          .replace(/%note%/g, timeWithEmojis.note)
                    : `It is currently the following time in my owner's timezone: ${timeWithEmojis.emoji} ${
                          timeWithEmojis.time + (timeWithEmojis.note !== '' ? `.\n\n${timeWithEmojis.note}.` : '.')
                      }`
            );
        } else if (command === 'uptime') {
            const botUptime = uptime();
            await this.bot.sendMessage(steamID, custom ? custom.replace(/%uptime%/g, botUptime) : botUptime);
        } else if (command === 'pure') {
            const pureStock = pure.stock(this.bot);
            await this.bot.sendMessage(
                steamID,
                custom
                    ? custom.replace(/%pure%/g, pureStock.join(' and '))
                    : `💰 I have ${pureStock.join(' and ')} in my inventory.`
            );
        } else if (command === 'rate') {
            const key = this.bot.pricelist.getKeyPrices;
            const isCustomPricer = this.bot.pricelist.isUseCustomPricer;
            const keyRate = key.sell.toString();
            const source =
                key.src === 'manual'
                    ? 'manual'
                    : isCustomPricer
                    ? 'custom-pricer'
                    : 'https://api.prices.tf/items/5021;6?src=bptf';

            await this.bot.sendMessage(
                steamID,
                custom
                    ? custom
                          .replace(/%keyRate%/g, keyRate)
                          .replace(/%keyPrices%/g, `${key.buy.metal} / ${key.sell.toString()}`)
                          .replace(/%source%/g, source)
                    : 'I value 🔑 Mann Co. Supply Crate Keys at ' +
                          keyRate +
                          '. This means that one key is the same as ' +
                          keyRate +
                          ', and ' +
                          keyRate +
                          ' is the same as one key.' +
                          `\n\nKey rate source: ${source}`
            );
        } else if (command === 'owner') {
            const firstAdmin = this.bot.getAdmins[0];
            const steamURL = `https://steamcommunity.com/profiles/${firstAdmin.toString()}`;
            const bptfURL = `https://backpack.tf/profiles/${firstAdmin.toString()}`;

            await this.bot.sendMessage(
                steamID,
                custom
                    ? custom
                          .replace(/%steamurl%/g, steamURL)
                          .replace(/%bptfurl%/g, bptfURL)
                          .replace(/%steamid%/, firstAdmin.toString())
                    : `• Steam: ${steamURL}\n• Backpack.tf: ${bptfURL}`
            );
        } else if (command === 'discord') {
            const inviteURL = (opt as Discord).inviteURL;
            let reply: string;
            if (custom) {
                reply = custom.replace(/%discordurl%/g, inviteURL);
            } else {
                if (inviteURL) {
                    reply = `Owner's Discord Server: ${inviteURL}`;
                    //
                } else return this.bot.sendMessage(steamID, '❌ The owner have not set the Discord invite link.');
            }
            await this.bot.sendMessage(steamID, reply);
        } else {
            const inventory = this.bot.inventoryManager.getInventory;
            const dict = inventory.getItems;
            const items: { amount: number; name: string }[] = [];

            for (const sku in dict) {
                if (!Object.prototype.hasOwnProperty.call(dict, sku)) {
                    continue;
                }

                if (['5021;6', '5002;6', '5001;6', '5000;6'].includes(sku)) {
                    continue;
                }

                items.push({
                    name: this.bot.schema.getName(SKU.fromString(sku), false),
                    amount: dict[sku].length
                });
            }

            items.sort((a, b) => {
                if (a.amount === b.amount) {
                    if (a.name < b.name) {
                        return -1;
                    } else if (a.name > b.name) {
                        return 1;
                    } else {
                        return 0;
                    }
                }
                const diff = b.amount - a.amount;
                return diff;
            });

            const pure = [
                {
                    name: 'Mann Co. Supply Crate Key',
                    amount: inventory.getAmount('5021;6', false)
                },
                {
                    name: 'Refined Metal',
                    amount: inventory.getAmount('5002;6', false)
                },
                {
                    name: 'Reclaimed Metal',
                    amount: inventory.getAmount('5001;6', false)
                },
                {
                    name: 'Scrap Metal',
                    amount: inventory.getAmount('5000;6', false)
                }
            ];

            const parsed = pure.concat(items);

            const stock: string[] = [];
            let left = 0;

            const max = (opt as Stock).maximumItems;

            const parsedCount = parsed.length;

            for (let i = 0; i < parsedCount; i++) {
                if (stock.length > max) {
                    left += parsed[i].amount;
                } else {
                    stock.push(`${parsed[i].name}: ${parsed[i].amount}`);
                }
            }

            const custom = opt.customReply.reply;
            let reply = custom
                ? custom.replace(/%stocklist%/g, stock.join(', \n'))
                : `/pre 📜 Here's a list of all the items that I have in my inventory:\n${stock.join(', \n')}`;

            if (left > 0) {
                reply += `,\nand ${left} other ${pluralize('item', left)}`;
            }

            await this.bot.sendMessage(steamID, reply);
        }
    }

    async weaponCommand(steamID: SteamID, type: CraftUncraft): Promise<void> {
        const opt = this.bot.options.commands[type];
        if (!opt.enable) {
            if (!this.bot.isAdmin(steamID)) {
                const custom = opt.customReply.disabled;
                return this.bot.sendMessage(steamID, custom ? custom : '❌ This command is disabled by the owner.');
            }
        }

        const weaponStock = this.getWeaponsStock(
            opt.showOnlyExist,
            type === 'craftweapon' ? this.bot.craftWeapons : this.bot.uncraftWeapons
        );

        let reply: string;
        if (weaponStock.length > 15) {
            const custom = opt.customReply.have;

            reply = custom
                ? custom.replace(/%list%/g, '')
                : `📃 Here's a list of all ${
                      type === 'craftweapon' ? 'craft' : 'uncraft'
                  } weapons stock in my inventory:\n\n`;

            await this.bot.sendMessage(steamID, reply);

            const listCount = weaponStock.length;
            const limit = 15;
            const loops = Math.ceil(listCount / 15);

            for (let i = 0; i < loops; i++) {
                const last = loops - i === 1;
                const i15 = i * 15;

                const firstOrLast = i < 1 ? limit : i15 + (listCount - i15);

                await this.bot.sendMessage(
                    steamID,
                    weaponStock.slice(i15, last ? firstOrLast : (i + 1) * 15).join('\n')
                );

                await sleepasync().Promise.sleep(3000);
            }

            return;
        } else if (weaponStock.length > 0) {
            const custom = opt.customReply.have;
            reply = custom
                ? custom.replace(/%list%/g, weaponStock.join(', \n'))
                : `📃 Here's a list of all ${
                      type === 'craftweapon' ? 'craft' : 'uncraft'
                  } weapons stock in my inventory:\n\n` + weaponStock.join(', \n');
        } else {
            const custom = opt.customReply.dontHave;
            reply = custom
                ? custom
                : `❌ I don't have any ${
                      type === 'craftweapon' ? 'craftable' : 'uncraftable'
                  } weapons in my inventory.`;
        }

        return this.bot.sendMessage(steamID, reply);
    }

    async paintsCommand(steamID: SteamID): Promise<void> {
        return this.bot.sendMessage(steamID, '/code ' + JSON.stringify(this.bot.paints, null, 4));
    }

    private getWeaponsStock(showOnlyExist: boolean, weapons: string[]): string[] {
        const items: { amount: number; name: string }[] = [];
        const inventory = this.bot.inventoryManager.getInventory;
        const schema = this.bot.schema;

        if (showOnlyExist) {
            weapons.forEach(sku => {
                const amount = inventory.getAmount(sku, false);
                if (amount > 0) {
                    items.push({
                        name: schema.getName(SKU.fromString(sku), false),
                        amount: amount
                    });
                }
            });
        } else {
            weapons.forEach(sku => {
                const amount = inventory.getAmount(sku, false);
                items.push({
                    name: schema.getName(SKU.fromString(sku), false),
                    amount: amount
                });
            });
        }

        items.sort((a, b) => {
            if (a.amount === b.amount) {
                if (a.name < b.name) {
                    return -1;
                } else if (a.name > b.name) {
                    return 1;
                } else {
                    return 0;
                }
            }
            const diff = b.amount - a.amount;
            return diff;
        });

        const stock: string[] = [];
        const itemsCount = items.length;

        if (itemsCount > 0) {
            for (let i = 0; i < itemsCount; i++) {
                stock.push(`${items[i].name}: ${items[i].amount}`);
            }
        }
        return stock;
    }
}
