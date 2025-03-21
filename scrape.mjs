import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fetch from 'node-fetch';
import fs from 'fs';

// Use Puppeteer Stealth Plugin
puppeteer.use(StealthPlugin());

const feedURL = 'https://www.ubereats.com/feed?diningMode=PICKUP&pl=JTdCJTIyYWRkcmVzcyUyMiUzQSUyMkdyYW5kJTIwQ2VudHJhbCUyMFRlcm1pbmFsJTIyJTJDJTIycmVmZXJlbmNlJTIyJTNBJTIyaGVyZSUzQXBkcyUzQXBsYWNlJTNBODQwZHI1cnUtMTBkZDRlOWZkYzE2YjIwNDU1YWRhYjY0NzVmMzhkNDQlMjIlMkMlMjJyZWZlcmVuY2VUeXBlJTIyJTNBJTIyaGVyZV9wbGFjZXMlMjIlMkMlMjJsYXRpdHVkZSUyMiUzQTQwLjc1MjM5JTJDJTIybG9uZ2l0dWRlJTIyJTNBLTczLjk3Nzg3JTdE';

console.log('launching puppeteer...');
const browser = await puppeteer.launch({ 
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
});
const page = (await browser.pages())[0];

console.log('getting nearby restaurants..');
await page.goto(feedURL, { waitUntil: 'networkidle2' });

const cards = 'div:has(> div > div > div > a[data-testid="store-card"])';
await page.waitForSelector(cards);

const restaurants = [];
for (const el of await page.$$(cards)) {
    const offer = await el.evaluate(e => e.querySelector('picture + div > div')?.textContent) || '';
    if (offer.includes('Get 1 Free') || offer.includes('Offers')) {
        restaurants.push(await el.evaluate(e => e.querySelector('a').href));
    }
}

console.log(`${restaurants.length} potential restaurants with offers found! closing puppeteer...`);
await browser.close();

const allCompiled = [];
for (let i = 0; i < restaurants.length; i++) {
    const url = restaurants[i];

    console.log(`(${i+1}/${restaurants.length}) fetching ${url}...`);

    const body = await fetch(url, {
        headers: {
            'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
    }).then(res => res.text());

    const reactData = body.match(/__REACT_QUERY_STATE__">(.*?)<\/script>/s)?.[1];
    const rawData = reactData && JSON.parse(decodeURIComponent(JSON.parse(`"${reactData.trim()}"`)));
    const data = rawData?.queries?.[0]?.state?.data;
    const section = data?.sections?.[0];

    if (data && section && section.isOnSale && data.catalogSectionsMap[section.uuid]) {
        const items = new Map();
        for (const { payload } of data.catalogSectionsMap[section.uuid]) {
            for (const item of payload.standardItemsPayload.catalogItems) {
                items.set(item.uuid, item);
            }
        }

        const deals = [];
        for (const item of items.values()) {
            if (item.itemPromotion) deals.push(item);
        }

        if (deals.length) { 
            const compiled = JSON.parse(data.metaJson);
            compiled.deals = deals;
            delete compiled.hasMenu;

            allCompiled.push(compiled);
            console.log(`got data for ${compiled.name}: ${deals.length} deal(s) found`);
        } else {
            console.log(`no deals found for this restaurant`);
        }
    } else {
        console.log(`no deals found for this restaurant`);
    }

    console.log('sleeping 3 seconds...');
    await new Promise(r => setTimeout(r, 3000));
}

fs.writeFileSync('./scraped.json', JSON.stringify(allCompiled));
